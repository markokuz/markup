declare module "utif" {
  interface IFD {
    width: number;
    height: number;
    data: Uint8Array;
  }

  export function decode(buffer: Uint8Array): IFD[];
  export function decodeImage(buffer: Uint8Array, ifd: IFD): void;
  export function toRGBA8(ifd: IFD): Uint8Array;
}
