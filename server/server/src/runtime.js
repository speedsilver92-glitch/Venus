export function corsOptionsFromOrigin(origin) {
  const value = String(origin || '').trim();
  if (!value) return null;
  return {
    origin: value,
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  };
}
