package com.orbitalhq.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.google.firebase.FirebaseApp;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 🔥 FORCE FIREBASE TO INITIALIZE
        FirebaseApp.initializeApp(this);
        super.onCreate(savedInstanceState);
    }
}