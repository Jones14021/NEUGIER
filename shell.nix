# Optional: lokale Toolchain ohne Docker (Editor-Support, Typecheck).
{ pkgs ? import <nixpkgs> { } }:
pkgs.mkShell {
  packages = [ pkgs.nodejs_24 ];
  shellHook = ''
    export NODE_OPTIONS=--disable-warning=ExperimentalWarning
  '';
}
