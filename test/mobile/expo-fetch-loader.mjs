const shimUrl = new URL('./expo-fetch-test-shim.mjs', import.meta.url).href;
const secureStoreShimUrl = new URL(
  './expo-secure-store-test-shim.mjs',
  import.meta.url,
).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'expo/fetch') {
    return {
      shortCircuit: true,
      url: shimUrl,
    };
  }
  if (specifier === 'expo-secure-store') {
    return {
      shortCircuit: true,
      url: secureStoreShimUrl,
    };
  }
  return nextResolve(specifier, context);
}
