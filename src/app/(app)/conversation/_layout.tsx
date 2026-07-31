import { Stack } from 'expo-router';

export default function ConversationLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="[sessionId]" />
      <Stack.Screen
        name="[sessionId]/voice"
        options={{ presentation: 'modal' }}
      />
    </Stack>
  );
}
