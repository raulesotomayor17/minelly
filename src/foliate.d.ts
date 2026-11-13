declare module "*/foliate-js/view.js" {
  export class View extends HTMLElement {
    book: any;
    renderer: any;
    open(book: any): Promise<void>;
    goTo(target: any): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    close(): void;
  }
  export function makeBook(file: File): Promise<any>;
}
declare module "*/foliate-js/toc.js" {
  export function flattenToc(items?: any[], depth?: number): Array<{ label: string; href: string; depth: number; subitems: number }>;
}
