import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

export type NativePointerBoundaryEventName =
  | "pointerdown"
  | "pointermove"
  | "pointerup"
  | "pointercancel"
  | "lostpointercapture"
  | "pointerleave";

type NativePointerBoundaryHandlers<T extends HTMLElement> = Partial<
  Record<NativePointerBoundaryEventName, (event: ReactPointerEvent<T>) => void>
>;

type NativePointerBoundaryOptions<T extends HTMLElement> = {
  targetRef: RefObject<T | null>;
  enabled?: boolean;
  handlers: NativePointerBoundaryHandlers<T>;
  reactHandledEvents: WeakSet<Event>;
  shouldFallback?: (event: PointerEvent) => boolean;
};

const deferToAfterEventPropagation = (callback: () => void): void => {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(callback);
    return;
  }
  void Promise.resolve().then(callback);
};

const nativePointerEventFor = <T extends HTMLElement>(event: PointerEvent, currentTarget: T): ReactPointerEvent<T> => {
  const adapted = new Proxy(event, {
    get(target, property) {
      if (property === "currentTarget") return currentTarget;
      if (property === "preventDefault") return target.preventDefault.bind(target);
      if (property === "stopPropagation") return target.stopPropagation.bind(target);
      if (property === "stopImmediatePropagation") return target.stopImmediatePropagation.bind(target);
      return Reflect.get(target, property, target);
    }
  });
  return adapted as unknown as ReactPointerEvent<T>;
};

/**
 * Keeps the production webview surface operable if React's delegated pointer
 * listener is skipped at the root. The native listener waits until bubbling
 * has completed, so normal React handlers remain authoritative whenever they
 * receive the event.
 */
export const useNativePointerBoundaryFallback = <T extends HTMLElement>({
  targetRef,
  enabled = true,
  handlers,
  reactHandledEvents,
  shouldFallback
}: NativePointerBoundaryOptions<T>): void => {
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!enabled) return undefined;
    const target = targetRef.current;
    if (!target) return undefined;

    const listeners = new Map<NativePointerBoundaryEventName, EventListener>();
    for (const eventName of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
      "lostpointercapture",
      "pointerleave"
    ] as const) {
      const listener: EventListener = (event) => {
        const pointerEvent = event as PointerEvent;
        const handler = handlersRef.current[eventName];
        if (!handler || (shouldFallback && !shouldFallback(pointerEvent))) return;
        deferToAfterEventPropagation(() => {
          if (reactHandledEvents.has(event)) return;
          handler(nativePointerEventFor(pointerEvent, target));
        });
      };
      listeners.set(eventName, listener);
      target.addEventListener(eventName, listener);
    }

    return () => {
      for (const [eventName, listener] of listeners) target.removeEventListener(eventName, listener);
    };
  }, [enabled, reactHandledEvents, shouldFallback, targetRef]);
};
