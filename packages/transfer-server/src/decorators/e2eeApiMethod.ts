/**
 * Decorator to mark methods as allowed E2EE API methods
 * Only methods decorated with @e2eeApiMethod can be called via the remote API
 */

// Symbol to store allowed methods metadata
export const E2EE_API_METHODS_KEY = Symbol('e2eeApiMethods');

/**
 * Decorator function to mark a method as an allowed E2EE API method
 */
export function e2eeApiMethod() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    // Get existing allowed methods or initialize empty set
    const allowedMethods =
      target.constructor[E2EE_API_METHODS_KEY] || new Set<string>();

    // Add this method to the allowed methods set
    allowedMethods.add(propertyKey);

    // Store the updated set back on the constructor
    target.constructor[E2EE_API_METHODS_KEY] = allowedMethods;

    return descriptor;
  };
}

/**
 * Check if a method is allowed to be called via E2EE API
 */
export function isMethodAllowed(instance: any, methodName: string): boolean {
  const constructor = instance.constructor;
  const allowedMethods = constructor[E2EE_API_METHODS_KEY] as Set<string>;

  return allowedMethods?.has(methodName) || false;
}
