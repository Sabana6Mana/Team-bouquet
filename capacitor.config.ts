import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.teambouquet.matchpoint',
  appName: 'MATCHPOINT',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // Capacitor 7 defaults this to "disable". "auto" provides a native
    // fallback if an Android 15 theme stops opting out of edge-to-edge.
    adjustMarginsForEdgeToEdge: 'auto',
  },
  plugins: {
    App: {
      disableBackButtonHandler: true,
    },
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      // Android 12's splash compatibility layer can keep a second launch
      // window above the WebView on some emulator/vendor builds. The native
      // launch theme already supplies the splash drawable, so hand control to
      // the rendered app immediately after the activity starts.
      launchShowDuration: 0,
      backgroundColor: '#F5FAF6',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#F5FAF6',
    },
  },
}

export default config
