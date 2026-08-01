import { Drawer } from 'expo-router/drawer';

import { WaveDrawerContent } from '@/features/navigation/wave-drawer-content';
import { useTheme } from '@/hooks/use-theme';

export default function AppLayout() {
  const theme = useTheme();

  return (
    <Drawer
      drawerContent={(props) => <WaveDrawerContent {...props} />}
      screenOptions={{
        drawerStyle: {
          backgroundColor: theme.background,
          borderRightColor: theme.backgroundElement,
          width: '88%',
        },
        headerShown: false,
        overlayColor: 'rgba(0, 0, 0, 0.36)',
        swipeEdgeWidth: 36,
      }}>
      {/* One screen: the native stack owns every app screen, so navigation
          between them gets native headers, push transitions, and swipe-back.
          The drawer is chrome around it, not a sibling switcher. */}
      <Drawer.Screen name="(stack)" />
    </Drawer>
  );
}
