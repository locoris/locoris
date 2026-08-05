package com.locoris.android

import android.app.PendingIntent
import android.content.Context
import android.net.wifi.WifiManager
import android.os.Bundle
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var mdnsMulticastLock: WifiManager.MulticastLock? = null
  private val googleDriveAuthorizationLauncher = registerForActivityResult(
    ActivityResultContracts.StartIntentSenderForResult()
  ) { result ->
    LocorisAndroidPlugin.handleGoogleDriveAuthorizationActivityResult(
      result.resultCode,
      result.data
    )
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    val wifiManager = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    mdnsMulticastLock = wifiManager?.createMulticastLock("locoris-self-hosted-discovery")?.apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  override fun onDestroy() {
    mdnsMulticastLock?.let { lock ->
      if (lock.isHeld) {
        lock.release()
      }
    }
    mdnsMulticastLock = null
    super.onDestroy()
  }

  fun launchGoogleDriveAuthorization(pendingIntent: PendingIntent) {
    googleDriveAuthorizationLauncher.launch(
      IntentSenderRequest.Builder(pendingIntent.intentSender).build()
    )
  }
}
