declare module 'prismjs' {
    export function highlightAll(): void;
    export function highlight(element: Element, callback?: (element: Element) => void): void;
  }
