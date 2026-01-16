import React, { useLayoutEffect, useRef, useState } from 'react';

export function useElementHeight(ref, fallback = 0) {
  const [height, setHeight] = useState(fallback);
  const elementRef = useRef(null);
  const cleanupRef = useRef(null);
  const fallbackRef = useRef(fallback);

  fallbackRef.current = fallback;

  const update = React.useCallback(() => {
    const element = elementRef.current;
    const fallbackValue = fallbackRef.current;
    if (!element) {
      setHeight((prev) => (prev === fallbackValue ? prev : fallbackValue));
      return;
    }

    const next = element.getBoundingClientRect().height;
    setHeight((prev) => {
      const value = Number.isFinite(next) && next > 0 ? Math.floor(next) : fallbackValue;
      if (Math.abs(prev - value) <= 1) return prev;
      return value;
    });
  }, []);

  useLayoutEffect(() => {
    const element = ref?.current || null;
    if (elementRef.current === element) return;

    if (typeof cleanupRef.current === 'function') {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    elementRef.current = element;

    if (!element) return;

    update();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      cleanupRef.current = () => window.removeEventListener('resize', update);
      return;
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    cleanupRef.current = () => observer.disconnect();
    return;
  });

  useLayoutEffect(
    () => () => {
      if (typeof cleanupRef.current === 'function') cleanupRef.current();
    },
    []
  );

  return height;
}

export function useElementWidth(ref, fallback = 0) {
  const [width, setWidth] = useState(fallback);
  const elementRef = useRef(null);
  const cleanupRef = useRef(null);
  const fallbackRef = useRef(fallback);

  fallbackRef.current = fallback;

  const update = React.useCallback(() => {
    const element = elementRef.current;
    const fallbackValue = fallbackRef.current;
    if (!element) {
      setWidth((prev) => (prev === fallbackValue ? prev : fallbackValue));
      return;
    }

    const next = element.getBoundingClientRect().width;
    setWidth((prev) => {
      const value = Number.isFinite(next) && next > 0 ? Math.floor(next) : fallbackValue;
      if (Math.abs(prev - value) <= 1) return prev;
      return value;
    });
  }, []);

  useLayoutEffect(() => {
    const element = ref?.current || null;
    if (elementRef.current === element) return;

    if (typeof cleanupRef.current === 'function') {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    elementRef.current = element;

    if (!element) return;

    update();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      cleanupRef.current = () => window.removeEventListener('resize', update);
      return;
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    cleanupRef.current = () => observer.disconnect();
    return;
  });

  useLayoutEffect(
    () => () => {
      if (typeof cleanupRef.current === 'function') cleanupRef.current();
    },
    []
  );

  return width;
}

