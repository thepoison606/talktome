# Installation
> `npm install --save @types/ini`

# Summary
This package contains type definitions for ini (https://github.com/npm/ini).

# Details
Files were exported from https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/ini.
## [index.d.ts](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/ini/index.d.ts)
````ts
interface EncodeOptions {
    align?: boolean;
    section?: string;
    sort?: boolean;
    whitespace?: boolean;
    newline?: boolean;
    platform?: string;
    bracketedArray?: boolean;
}

interface DecodeOptions {
    bracketedArray?: boolean;
}

export function decode(str: string, options?: DecodeOptions): {
    [key: string]: any;
};
export function parse(str: string, options?: DecodeOptions): {
    [key: string]: any;
};
export function encode(object: any, options?: EncodeOptions | string): string;
export function stringify(object: any, options?: EncodeOptions | string): string;
export function safe(val: string): string;
export function unsafe(val: string): string;

````

### Additional Details
 * Last updated: Sun, 09 Jun 2024 05:35:20 GMT
 * Dependencies: none

# Credits
These definitions were written by [Marcin Porębski](https://github.com/marcinporebski), [Chris Arnesen](https://github.com/carnesen), and [Adaline Simonian](https://github.com/adalinesimonian).
