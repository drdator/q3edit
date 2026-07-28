export function panelSubhead(label: string, className = ''): HTMLHeadingElement {
  const heading = document.createElement('h3');
  heading.className = `panel-subhead ${className}`.trim();
  heading.textContent = label;
  return heading;
}
