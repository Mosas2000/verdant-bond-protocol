import { RequestMethod } from '@nestjs/common';
import {
  ROUTE_AUTHORIZATION_MATRIX,
  RouteAuthEntry,
} from './route-authorization.matrix';

const METHOD_BY_NUMBER: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.ALL]: 'ALL',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD',
  [RequestMethod.SEARCH]: 'SEARCH',
};

const GUARDS_METADATA = '__guards__';

/**
 * Reads the guard classes actually wired onto a controller handler, merging any
 * class-level `@UseGuards` with the method-level ones (Nest applies both).
 * Returns guard class names so comparisons are stable regardless of instance vs
 * class metadata representation.
 */
function resolveGuardNames(controller: any, method: string): string[] {
  const proto = controller.prototype;
  const classGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, controller) || [];
  const methodGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, proto[method]) || [];
  return [...classGuards, ...methodGuards]
    .map((g) => (typeof g === 'function' ? g : g?.constructor))
    .filter(Boolean)
    .map((c: any) => c.name)
    .sort();
}

/**
 * Enumerates every route handler declared on a controller at runtime and returns
 * them keyed by method name, including the resolved HTTP verb and full path.
 */
function enumerateHandlers(controller: any): Map<string, { httpMethod: string; path: string }> {
  const proto = controller.prototype;
  const basePath: string = Reflect.getMetadata('path', controller) || '';
  const handlers = new Map<string, { httpMethod: string; path: string }>();
  Object.getOwnPropertyNames(proto).forEach((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const httpMethodNumber: number | undefined = Reflect.getMetadata('method', descriptor.value);
    if (httpMethodNumber === undefined) return;
    const handlerPath: string = Reflect.getMetadata('path', descriptor.value) || '';
    const normalizedHandlerPath = handlerPath === '/' ? '' : handlerPath;
    const fullPath = [basePath, normalizedHandlerPath].filter(Boolean).join('/');
    handlers.set(name, {
      httpMethod: METHOD_BY_NUMBER[httpMethodNumber] ?? String(httpMethodNumber),
      path: fullPath,
    });
  });
  return handlers;
}

describe('Route authorization matrix', () => {
  const matrixByController = new Map<any, RouteAuthEntry[]>();
  ROUTE_AUTHORIZATION_MATRIX.forEach((entry) => {
    const list = matrixByController.get(entry.controller) || [];
    list.push(entry);
    matrixByController.set(entry.controller, list);
  });

  it('declares a guard set for every wired handler and matches reality', () => {
    const failures: string[] = [];

    matrixByController.forEach((entries, controller) => {
      const handlers = enumerateHandlers(controller);
      const seen = new Set<string>();

      entries.forEach((entry) => {
        seen.add(entry.method);
        const handler = handlers.get(entry.method);
        if (!handler) {
          failures.push(
            `${controller.name}.${entry.method} is in the matrix but has no matching route handler`,
          );
          return;
        }
        if (handler.httpMethod !== entry.httpMethod) {
          failures.push(
            `${controller.name}.${entry.method} HTTP method mismatch: matrix=${entry.httpMethod} actual=${handler.httpMethod}`,
          );
        }
        if (handler.path !== entry.path) {
          failures.push(
            `${controller.name}.${entry.method} path mismatch: matrix=${entry.path} actual=${handler.path}`,
          );
        }

        const actualGuards = resolveGuardNames(controller, entry.method).sort();
        const expectedGuards = entry.guards.map((g) => g.name).sort();
        if (JSON.stringify(actualGuards) !== JSON.stringify(expectedGuards)) {
          failures.push(
            `${controller.name}.${entry.method} guard mismatch: matrix=[${expectedGuards}] actual=[${actualGuards}]`,
          );
        }
      });

      // Any handler not represented in the matrix is an un-reviewed route.
      handlers.forEach((_handler, method) => {
        if (!seen.has(method)) {
          failures.push(
            `${controller.name}.${method} is a real route handler but is missing from the authorization matrix`,
          );
        }
      });
    });

    if (failures.length) {
      throw new Error(
        `Route authorization matrix out of sync with controllers:\n- ${failures.join('\n- ')}`,
      );
    }
    expect(failures).toEqual([]);
  });

  it('treats every mutation endpoint as either guarded, wallet-header, or explicitly public', () => {
    const unclassified = ROUTE_AUTHORIZATION_MATRIX.filter(
      (e) => e.mutation && !['admin', 'authenticated', 'wallet-header', 'public'].includes(e.role),
    );
    expect(unclassified).toEqual([]);
  });

  it('distinguishes admin-only routes from public/authenticated routes', () => {
    const adminRoutes = ROUTE_AUTHORIZATION_MATRIX.filter((e) => e.role === 'admin');
    expect(adminRoutes.length).toBeGreaterThan(0);
    adminRoutes.forEach((route) => {
      expect(route.guards.map((g) => g.name)).toEqual(
        expect.arrayContaining(['JwtAuthGuard', 'AdminGuard']),
      );
    });
  });
});
