export function requireElement(element, description) {
  if (!element) {
    throw new Error(`${description} not found`);
  }
  return element;
}
