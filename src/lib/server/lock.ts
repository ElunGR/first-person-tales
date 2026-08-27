/** Shared session mutex serializing all session mutations across routes. */
import { Mutex } from './mutex';

export const sessionLock = new Mutex();
