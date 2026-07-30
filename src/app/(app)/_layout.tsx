import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
      <Stack.Screen
        name="sessions"
        options={{
          gestureEnabled: false,
          headerBackVisible: false,
          title: 'Wave',
        }}
      />
      <Stack.Screen
        name="sessions/[sessionId]"
        options={{ title: 'Hermes' }}
      />
      <Stack.Screen
        name="development"
        options={{ title: 'Development' }}
      />
    </Stack>
  );
}
