/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /** usuario con sesión (lo rellena el middleware; en páginas públicas como /login puede faltar) */
    usuario?: import('./lib/auth').Usuario;
  }
}
