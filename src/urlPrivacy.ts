export const withoutUrlParameters = (value: string): string => value.split(/[?#]/, 1)[0];

export const hasUrlParameters = (value: string): boolean => /[?#]/.test(value);
