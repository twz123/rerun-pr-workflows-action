import {FunctionLike, Mock} from 'jest-mock';
import {jest} from '@jest/globals';

/**
 * A type that makes all properties optional, recursively.
 *
 * There seem to be some recursion problems when it comes to arrays in very
 * complex types. Code completion works great inside the IDE, but the compiler
 * complains.
 *
 * @see https://stackoverflow.com/a/51365037
 */
type Stub<T> = {
  [P in keyof T]?: T[P] extends (infer U)[]
    ? Stub<U>[]
    : T[P] extends object | undefined
    ? Stub<T[P]>
    : T[P];
};

/** Constructs instances of `T` where not all things have to be present. */
export function stub<T>(partial: Stub<T>): T {
  return partial as T;
}

/** Stubs a function using Jest. */
export function stubFn<T extends FunctionLike>(
  implementation?: T | undefined,
): Mock<T> & T {
  const fn = jest.fn<T>(implementation);
  return fn as Mock<T> & T;
}
