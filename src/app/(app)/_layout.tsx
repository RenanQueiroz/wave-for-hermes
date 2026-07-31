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
      <Drawer.Screen name="new" />
      <Drawer.Screen name="conversation" />
      <Drawer.Screen name="search" />
      <Drawer.Screen name="operations/jobs" />
      <Drawer.Screen name="settings" />
      <Drawer.Screen name="development" />
    </Drawer>
  );
}
