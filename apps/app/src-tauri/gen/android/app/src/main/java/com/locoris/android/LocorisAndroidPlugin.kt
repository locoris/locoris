package com.locoris.android

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.ClearTokenRequest
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.auth.api.identity.RevokeAccessRequest
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONArray

private const val DEFAULT_GOOGLE_DRIVE_APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata"
private const val DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 55 * 60
private const val GOOGLE_DRIVE_AUTHORIZATION_TIMEOUT_MS = 3 * 60 * 1000L
private const val ANDROID_APK_MIME_TYPE = "application/vnd.android.package-archive"
private const val LOCORIS_ANDROID_TAG = "LocorisAndroid"

@InvokeArg
class GoogleDriveAuthorizeArgs {
  var scopes: List<String>? = null
  var silent: Boolean = false
}

@InvokeArg
class GoogleDriveClearTokenArgs {
  var token: String? = null
}

@InvokeArg
class SecureSecretArgs {
  lateinit var key: String
  var value: String? = null
}

@InvokeArg
class InstallApkUpdateArgs {
  lateinit var url: String
  var fileName: String? = null
  var expectedPackageName: String? = null
  var expectedSizeBytes: Long? = null
}

@TauriPlugin
class LocorisAndroidPlugin(private val activity: Activity) : Plugin(activity) {
  private var googleDriveAuthorizationInFlight = false
  private val mainHandler = Handler(Looper.getMainLooper())
  private var googleDriveAuthorizationTimeout: Runnable? = null
  @Volatile private var updateDownloadProgressPercent: Int? = null
  private val securePreferences: SharedPreferences by lazy {
    val masterKey = MasterKey.Builder(activity.applicationContext)
      .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
      .build()

    EncryptedSharedPreferences.create(
      activity.applicationContext,
      "locoris_secure_secrets",
      masterKey,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
  }

  @Command
  fun googleDriveCheckAvailability(invoke: Invoke) {
    val status = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(activity)

    if (status == ConnectionResult.SUCCESS) {
      invoke.resolve(JSObject().put("available", true))
      return
    }

    invoke.reject("GOOGLE_PLAY_SERVICES_UNAVAILABLE")
  }

  @Command
  fun googleDriveAuthorize(invoke: Invoke) {
    if (googleDriveAuthorizationInFlight) {
      invoke.reject("GOOGLE_OAUTH_IN_PROGRESS")
      return
    }

    googleDriveAuthorizationInFlight = true

    try {
      val args = invoke.parseArgs(GoogleDriveAuthorizeArgs::class.java)
      val requestedScopes = normalizeScopes(args.scopes)
      val request = AuthorizationRequest.builder()
        .setRequestedScopes(requestedScopes)
        .build()

      Identity.getAuthorizationClient(activity)
        .authorize(request)
        .addOnSuccessListener { authorizationResult ->
          if (authorizationResult.hasResolution()) {
            if (args.silent) {
              googleDriveAuthorizationInFlight = false
              invoke.reject("GOOGLE_DRIVE_AUTH_REQUIRED")
              return@addOnSuccessListener
            }

            val pendingIntent = authorizationResult.pendingIntent

            if (pendingIntent == null) {
              googleDriveAuthorizationInFlight = false
              invoke.reject("GOOGLE_OAUTH_FAILED")
              return@addOnSuccessListener
            }

            try {
              pendingGoogleDriveAuthorizationPlugin = this
              pendingGoogleDriveAuthorizationInvoke = invoke
              val mainActivity = activity as? MainActivity

              if (mainActivity == null) {
                throw IllegalStateException("Google authorization requires MainActivity")
              }

              scheduleGoogleDriveAuthorizationTimeout(invoke)
              mainActivity.launchGoogleDriveAuthorization(pendingIntent)
            } catch (error: Exception) {
              Log.w(LOCORIS_ANDROID_TAG, "Unable to launch Google Drive authorization resolution", error)
              cancelGoogleDriveAuthorizationTimeout()
              clearPendingGoogleDriveAuthorization(this, invoke)
              googleDriveAuthorizationInFlight = false
              invoke.reject("GOOGLE_OAUTH_FAILED")
            }
          } else {
            googleDriveAuthorizationInFlight = false
            resolveAuthorizationResult(invoke, authorizationResult)
          }
        }
        .addOnFailureListener { error ->
          googleDriveAuthorizationInFlight = false
          rejectGoogleDriveError(invoke, error)
        }
    } catch (error: Exception) {
      Log.w(LOCORIS_ANDROID_TAG, "Unable to start Google Drive authorization", error)
      googleDriveAuthorizationInFlight = false
      invoke.reject("GOOGLE_OAUTH_FAILED")
    }
  }

  private fun handleGoogleDriveAuthorizationResult(invoke: Invoke, resultCode: Int, data: Intent?) {
    cancelGoogleDriveAuthorizationTimeout()
    googleDriveAuthorizationInFlight = false

    if (resultCode == Activity.RESULT_CANCELED) {
      invoke.reject("GOOGLE_OAUTH_ACCESS_DENIED")
      return
    }

    if (data == null) {
      invoke.reject("GOOGLE_OAUTH_CALLBACK_FAILED")
      return
    }

    try {
      val authorizationResult = Identity.getAuthorizationClient(activity)
        .getAuthorizationResultFromIntent(data)
      resolveAuthorizationResult(invoke, authorizationResult)
    } catch (error: Exception) {
      rejectGoogleDriveError(invoke, error)
    }
  }

  @Command
  fun googleDriveClearToken(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(GoogleDriveClearTokenArgs::class.java)
      val token = args.token?.trim().orEmpty()

      if (token.isEmpty()) {
        invoke.resolve()
        return
      }

      Identity.getAuthorizationClient(activity)
        .clearToken(ClearTokenRequest.builder().setToken(token).build())
        .addOnSuccessListener { invoke.resolve() }
        .addOnFailureListener { invoke.reject("GOOGLE_OAUTH_FAILED") }
    } catch (_: Exception) {
      invoke.reject("GOOGLE_OAUTH_FAILED")
    }
  }

  @Command
  fun googleDriveRevokeAccess(invoke: Invoke) {
    try {
      Identity.getAuthorizationClient(activity)
        .revokeAccess(RevokeAccessRequest.builder().build())
        .addOnSuccessListener { invoke.resolve() }
        .addOnFailureListener { invoke.reject("GOOGLE_OAUTH_REVOKE_FAILED") }
    } catch (_: Exception) {
      invoke.reject("GOOGLE_OAUTH_REVOKE_FAILED")
    }
  }

  @Command
  fun secureSecretGet(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SecureSecretArgs::class.java)
      val key = normalizeSecretKey(args.key)
      val result = JSObject()
      result.put("value", securePreferences.getString(key, null))
      invoke.resolve(result)
    } catch (error: IllegalArgumentException) {
      invoke.reject(error.message)
    } catch (_: Exception) {
      invoke.reject("SECURE_SECRET_UNAVAILABLE")
    }
  }

  @Command
  fun secureSecretSet(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SecureSecretArgs::class.java)
      val key = normalizeSecretKey(args.key)
      val value = args.value?.trim().orEmpty()
      val editor = securePreferences.edit()

      if (value.isEmpty()) {
        editor.remove(key)
      } else {
        editor.putString(key, value)
      }

      editor.apply()
      invoke.resolve()
    } catch (error: IllegalArgumentException) {
      invoke.reject(error.message)
    } catch (_: Exception) {
      invoke.reject("SECURE_SECRET_UNAVAILABLE")
    }
  }

  @Command
  fun secureSecretDelete(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SecureSecretArgs::class.java)
      val key = normalizeSecretKey(args.key)
      securePreferences.edit().remove(key).apply()
      invoke.resolve()
    } catch (error: IllegalArgumentException) {
      invoke.reject(error.message)
    } catch (_: Exception) {
      invoke.reject("SECURE_SECRET_UNAVAILABLE")
    }
  }

  @Command
  fun installApkUpdate(invoke: Invoke) {
    val args = try {
      invoke.parseArgs(InstallApkUpdateArgs::class.java)
    } catch (_: Exception) {
      invoke.reject("ANDROID_UPDATE_INVALID_REQUEST")
      return
    }

    val updateUrl = args.url.trim()
    val expectedPackageName = args.expectedPackageName?.trim().orEmpty()

    if (!updateUrl.startsWith("https://", ignoreCase = true)) {
      invoke.reject("ANDROID_UPDATE_INVALID_URL")
      return
    }

    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
      !activity.packageManager.canRequestPackageInstalls()
    ) {
      invoke.reject("ANDROID_INSTALL_PERMISSION_REQUIRED")
      return
    }

    Thread {
      try {
        val apkFile = downloadApk(updateUrl, args.fileName, args.expectedSizeBytes)
        validateDownloadedApk(apkFile, expectedPackageName)

        activity.runOnUiThread {
          try {
            openApkInstaller(apkFile)
            invoke.resolve(JSObject().put("started", true))
          } catch (_: Exception) {
            invoke.reject("ANDROID_UPDATE_INSTALLER_FAILED")
          }
        }
      } catch (error: IllegalArgumentException) {
        updateDownloadProgressPercent = null
        activity.runOnUiThread { invoke.reject(error.message ?: "ANDROID_UPDATE_INVALID_APK") }
      } catch (_: Exception) {
        updateDownloadProgressPercent = null
        activity.runOnUiThread { invoke.reject("ANDROID_UPDATE_DOWNLOAD_FAILED") }
      }
    }.start()
  }

  @Command
  fun getApkUpdateProgress(invoke: Invoke) {
    val result = JSObject()
    result.put("progress", updateDownloadProgressPercent ?: -1)
    invoke.resolve(result)
  }

  @Command
  fun openInstallPermissionSettings(invoke: Invoke) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      invoke.resolve()
      return
    }

    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:${activity.packageName}")
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

      activity.startActivity(intent)
      invoke.resolve()
    } catch (_: Exception) {
      invoke.reject("ANDROID_INSTALL_PERMISSION_SETTINGS_FAILED")
    }
  }

  @Command
  fun getPackageName(invoke: Invoke) {
    invoke.resolve(JSObject().put("packageName", activity.packageName))
  }

  private fun normalizeScopes(scopes: List<String>?): List<Scope> {
    val normalized = scopes
      ?.map { it.trim() }
      ?.filter { it.isNotEmpty() }
      ?.distinct()
      ?: emptyList()
    val resolvedScopes = normalized.ifEmpty { listOf(DEFAULT_GOOGLE_DRIVE_APP_DATA_SCOPE) }

    return resolvedScopes.map { Scope(it) }
  }

  private fun resolveAuthorizationResult(invoke: Invoke, authorizationResult: AuthorizationResult) {
    val accessToken = authorizationResult.accessToken?.trim().orEmpty()

    if (accessToken.isEmpty()) {
      invoke.reject("GOOGLE_DRIVE_AUTH_REQUIRED")
      return
    }

    val grantedScopes = JSONArray()
    authorizationResult.grantedScopes.forEach { grantedScopes.put(it) }

    val result = JSObject()
      .put("accessToken", accessToken)
      .put("expiresIn", DEFAULT_ACCESS_TOKEN_TTL_SECONDS)
      .put("grantedScopes", grantedScopes)

    try {
      val account = authorizationResult.toGoogleSignInAccount()
      result
        .put("userId", account?.id)
        .put("userName", account?.displayName)
        .put("userEmail", account?.email)
    } catch (_: Exception) {
      result
        .put("userId", null)
        .put("userName", null)
        .put("userEmail", null)
    }

    invoke.resolve(result)
  }

  private fun scheduleGoogleDriveAuthorizationTimeout(invoke: Invoke) {
    cancelGoogleDriveAuthorizationTimeout()
    val timeout = Runnable {
      if (pendingGoogleDriveAuthorizationInvoke === invoke) {
        clearPendingGoogleDriveAuthorization(this, invoke)
        googleDriveAuthorizationInFlight = false
        invoke.reject("GOOGLE_OAUTH_REDIRECT_TIMEOUT")
      }
      googleDriveAuthorizationTimeout = null
    }
    googleDriveAuthorizationTimeout = timeout
    mainHandler.postDelayed(timeout, GOOGLE_DRIVE_AUTHORIZATION_TIMEOUT_MS)
  }

  private fun cancelGoogleDriveAuthorizationTimeout() {
    googleDriveAuthorizationTimeout?.let(mainHandler::removeCallbacks)
    googleDriveAuthorizationTimeout = null
  }

  private fun rejectGoogleDriveError(invoke: Invoke, error: Exception) {
    Log.w(LOCORIS_ANDROID_TAG, "Google Drive authorization failed", error)

    if (error is ApiException) {
      when (error.statusCode) {
        ConnectionResult.CANCELED -> {
          invoke.reject("GOOGLE_OAUTH_ACCESS_DENIED")
          return
        }
        ConnectionResult.DEVELOPER_ERROR -> {
          invoke.reject("GOOGLE_OAUTH_ANDROID_CONFIG_INVALID")
          return
        }
        ConnectionResult.NETWORK_ERROR -> {
          invoke.reject("NETWORK_ERROR")
          return
        }
        ConnectionResult.SERVICE_MISSING,
        ConnectionResult.SERVICE_DISABLED,
        ConnectionResult.SERVICE_INVALID,
        ConnectionResult.SERVICE_VERSION_UPDATE_REQUIRED -> {
          invoke.reject("GOOGLE_PLAY_SERVICES_UNAVAILABLE")
          return
        }
      }
    }

    invoke.reject("GOOGLE_OAUTH_FAILED")
  }

  companion object {
    private var pendingGoogleDriveAuthorizationPlugin: LocorisAndroidPlugin? = null
    private var pendingGoogleDriveAuthorizationInvoke: Invoke? = null

    private fun clearPendingGoogleDriveAuthorization(plugin: LocorisAndroidPlugin?, invoke: Invoke?) {
      if (
        pendingGoogleDriveAuthorizationPlugin === plugin ||
        pendingGoogleDriveAuthorizationInvoke === invoke
      ) {
        pendingGoogleDriveAuthorizationPlugin = null
        pendingGoogleDriveAuthorizationInvoke = null
      }
    }

    fun handleGoogleDriveAuthorizationActivityResult(resultCode: Int, data: Intent?) {
      val plugin = pendingGoogleDriveAuthorizationPlugin
      val invoke = pendingGoogleDriveAuthorizationInvoke
      pendingGoogleDriveAuthorizationPlugin = null
      pendingGoogleDriveAuthorizationInvoke = null

      if (plugin == null || invoke == null) {
        Log.w(LOCORIS_ANDROID_TAG, "Google Drive authorization result arrived without a pending request")
        return
      }

      plugin.handleGoogleDriveAuthorizationResult(invoke, resultCode, data)
    }
  }

  private fun normalizeSecretKey(key: String): String {
    val normalized = key.trim()

    if (normalized.isEmpty()) {
      throw IllegalArgumentException("secure secret key is required")
    }

    if (normalized.length > 512) {
      throw IllegalArgumentException("secure secret key is too long")
    }

    return normalized
  }

  private fun downloadApk(updateUrl: String, requestedFileName: String?, expectedSizeBytes: Long?): File {
    val updatesDirectory = File(activity.cacheDir, "locoris-updates")

    if (!updatesDirectory.exists() && !updatesDirectory.mkdirs()) {
      throw IllegalStateException("ANDROID_UPDATE_CACHE_UNAVAILABLE")
    }

    val apkFile = File(updatesDirectory, normalizeApkFileName(requestedFileName))
    val connection = URL(updateUrl).openConnection() as HttpURLConnection

    connection.instanceFollowRedirects = true
    connection.connectTimeout = 15_000
    connection.readTimeout = 120_000
    connection.setRequestProperty("Accept", ANDROID_APK_MIME_TYPE)
    connection.setRequestProperty("User-Agent", "Locoris-Android-Updater")

    try {
      val statusCode = connection.responseCode

      if (statusCode !in 200..299) {
        throw IllegalStateException("ANDROID_UPDATE_DOWNLOAD_FAILED")
      }

      val expectedSize = expectedSizeBytes?.takeIf { it > 0L } ?: -1L
      val contentSize = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) connection.contentLengthLong else connection.contentLength.toLong()
      val totalBytes = if (contentSize > 0L) contentSize else expectedSize
      updateDownloadProgressPercent = if (totalBytes > 0L) 0 else null

      connection.inputStream.use { input ->
        apkFile.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          var downloadedBytes = 0L
          var lastProgress = -1

          while (true) {
            val bytesRead = input.read(buffer)

            if (bytesRead <= 0) {
              break
            }

            output.write(buffer, 0, bytesRead)
            downloadedBytes += bytesRead.toLong()

            if (totalBytes > 0L) {
              val nextProgress = ((downloadedBytes * 100L) / totalBytes).toInt().coerceIn(0, 99)

              if (nextProgress != lastProgress) {
                updateDownloadProgressPercent = nextProgress
                lastProgress = nextProgress
              }
            }
          }
        }
      }

      updateDownloadProgressPercent = 100
    } finally {
      connection.disconnect()
    }

    if (!apkFile.exists() || apkFile.length() <= 0L) {
      throw IllegalStateException("ANDROID_UPDATE_DOWNLOAD_FAILED")
    }

    return apkFile
  }

  private fun normalizeApkFileName(requestedFileName: String?): String {
    val safeName = requestedFileName
      ?.trim()
      ?.replace(Regex("[^A-Za-z0-9._-]"), "-")
      ?.takeIf { it.isNotEmpty() }
      ?: "locoris-update.apk"

    return if (safeName.endsWith(".apk", ignoreCase = true)) safeName else "$safeName.apk"
  }

  private fun validateDownloadedApk(apkFile: File, expectedPackageName: String) {
    if (expectedPackageName.isEmpty()) {
      return
    }

    val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      activity.packageManager.getPackageArchiveInfo(
        apkFile.absolutePath,
        PackageManager.PackageInfoFlags.of(0)
      )
    } else {
      @Suppress("DEPRECATION")
      activity.packageManager.getPackageArchiveInfo(apkFile.absolutePath, 0)
    }

    val packageName = packageInfo?.packageName?.trim().orEmpty()

    if (packageName != expectedPackageName) {
      throw IllegalArgumentException("ANDROID_UPDATE_PACKAGE_MISMATCH")
    }
  }

  private fun openApkInstaller(apkFile: File) {
    val contentUri = FileProvider.getUriForFile(
      activity,
      "${activity.packageName}.fileprovider",
      apkFile
    )
    val intent = Intent(Intent.ACTION_VIEW)
      .setDataAndType(contentUri, ANDROID_APK_MIME_TYPE)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    intent.clipData = ClipData.newUri(activity.contentResolver, "Locoris update", contentUri)
    activity.startActivity(intent)
  }
}
