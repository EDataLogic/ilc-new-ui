import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ihld.iliveconnect',
  appName: 'iLive Connect',
  webDir: 'dist',
  ios: { contentInset: 'automatic' },
  android: { allowMixedContent: false }
};

export default config;
