import { LogBox } from 'react-native';

// Reanimated warns once, in development only, when the phone has reduced motion
// on. Respecting that setting is intended, so the warning is noise. Imported
// first in the root layout because the warning fires while imports load.
LogBox.ignoreLogs(['[Reanimated] Reduced motion setting is enabled']);
