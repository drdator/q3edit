import type { BrushPrimitive } from './brush-primitives';
import { brushPrimitiveIconName } from './brush-primitives';

const CONE_ICON = `
<svg class="tool-icon-svg" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <path d="M16 3C16.3857 3 16.7375 3.22207 16.9033 3.57031L26.9033 24.5703C26.9672 24.7045 27 24.8514 27 25C27 26.0001 26.4874 26.8025 25.791 27.3994C25.1079 27.985 24.1926 28.427 23.1914 28.7607C21.1813 29.4308 18.5659 29.75 16 29.75C13.4341 29.75 10.8187 29.4308 8.80859 28.7607C7.80737 28.427 6.89214 27.985 6.20898 27.3994C5.51255 26.8025 5 26.0001 5 25C5 24.8514 5.03284 24.7045 5.09668 24.5703L15.0967 3.57031C15.2625 3.22207 15.6143 3 16 3ZM7.02051 25.1816C7.06802 25.3883 7.2051 25.6207 7.50977 25.8818C7.92029 26.2337 8.56774 26.573 9.44141 26.8643C11.1813 27.4442 13.566 27.75 16 27.75C18.434 27.75 20.8187 27.4442 22.5586 26.8643C23.4323 26.573 24.0797 26.2337 24.4902 25.8818C24.7948 25.6208 24.931 25.3882 24.9785 25.1816L16 6.32617L7.02051 25.1816Z" fill="currentColor"/>
</svg>`;

const PYRAMID_ICON = `
<svg class="tool-icon-svg" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <path d="M16.0003 3C16.359 3.00011 16.6905 3.19242 16.8685 3.50391L28.8685 24.5039C29.0203 24.7697 29.0417 25.0911 28.9271 25.375C28.8123 25.6585 28.5741 25.8742 28.2806 25.96L16.2806 29.46C16.0978 29.5133 15.9028 29.5132 15.72 29.46L3.72003 25.96C3.42637 25.8742 3.18832 25.6586 3.07355 25.375C2.95884 25.091 2.9802 24.7698 3.13214 24.5039L15.1321 3.50391L15.2054 3.39258C15.393 3.14708 15.6863 3 16.0003 3ZM5.49738 24.3945L15.0003 27.166V7.76367L5.49738 24.3945ZM17.0003 27.166L26.5023 24.3945L17.0003 7.76465V27.166Z" fill="currentColor"/>
</svg>`;

export function brushPrimitiveToolbarIconMarkup(primitive: BrushPrimitive): string {
  if (primitive === 'cone') return CONE_ICON;
  if (primitive === 'pyramid') return PYRAMID_ICON;
  return `<i class="ph ph-${brushPrimitiveIconName(primitive)}"></i>`;
}

export function brushPrimitiveToolbarTitle(primitive: BrushPrimitive): string {
  return `Create ${primitive} brush (2)`;
}

export function applyBrushPrimitiveToolbarIcon(button: HTMLElement | null, primitive: BrushPrimitive): void {
  if (!button) return;
  button.innerHTML = brushPrimitiveToolbarIconMarkup(primitive);
  button.title = brushPrimitiveToolbarTitle(primitive);
}
