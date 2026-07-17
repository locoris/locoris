package com.locoris.android

import android.app.PendingIntent
import android.os.Bundle
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
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
  }

  fun launchGoogleDriveAuthorization(pendingIntent: PendingIntent) {
    googleDriveAuthorizationLauncher.launch(
      IntentSenderRequest.Builder(pendingIntent.intentSender).build()
    )
  }
}
