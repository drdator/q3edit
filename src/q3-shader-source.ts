export interface ShaderSourceDiagnostic {
  line: number;
  message: string;
}

export interface ShaderSourceValidation {
  valid: boolean;
  shaderNames: string[];
  diagnostics: ShaderSourceDiagnostic[];
}

export interface ProjectShaderSourceValidation {
  valid: boolean;
  files: Record<string, ShaderSourceValidation>;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, match => ' '.repeat(match.length));
}

export function validateShaderSource(source: string): ShaderSourceValidation {
  const clean = stripComments(source);
  const diagnostics: ShaderSourceDiagnostic[] = [];
  const shaderNames: string[] = [];
  const stack: number[] = [];
  let pendingNameValue = '';
  let pendingNameLine = 1;
  let token = '';
  let tokenLine = 1;
  let line = 1;

  const flushToken = () => {
    const value = token.trim();
    token = '';
    if (!value) return;
    if (stack.length === 0) {
      if (pendingNameValue) {
        diagnostics.push({ line: tokenLine, message: `Unexpected token "${value}" before shader block` });
      } else {
        pendingNameValue = value;
        pendingNameLine = tokenLine;
      }
    }
  };

  for (let index = 0; index < clean.length; index++) {
    const char = clean[index];
    if (char === '\n') line++;
    if (char === '{' || char === '}') {
      flushToken();
      if (char === '{') {
        if (stack.length === 0) {
          if (!pendingNameValue) diagnostics.push({ line, message: 'Shader block is missing a name' });
          else {
            const normalized = pendingNameValue.toLowerCase().replace(/\\/g, '/').replace(/^textures\//, '');
            if (!normalized.includes('/')) diagnostics.push({ line: pendingNameLine, message: 'Shader names should include a texture directory' });
            if (shaderNames.includes(normalized)) diagnostics.push({ line: pendingNameLine, message: `Duplicate shader: ${normalized}` });
            else shaderNames.push(normalized);
          }
          pendingNameValue = '';
        }
        stack.push(line);
      } else if (stack.length === 0) {
        diagnostics.push({ line, message: 'Unexpected closing brace' });
      } else {
        stack.pop();
      }
      continue;
    }
    if (char <= ' ') {
      flushToken();
      continue;
    }
    if (!token) tokenLine = line;
    token += char;
  }
  flushToken();
  for (const openingLine of stack) diagnostics.push({ line: openingLine, message: 'Unclosed shader block' });
  if (pendingNameValue) diagnostics.push({ line: pendingNameLine, message: `Shader name "${pendingNameValue}" has no block` });
  if (shaderNames.length === 0 && source.trim()) diagnostics.push({ line: 1, message: 'No shader definitions found' });
  return { valid: diagnostics.length === 0, shaderNames, diagnostics };
}

export function normalizeProjectShaderPath(path: string): string {
  const segments = path.trim().replace(/\\/g, '/').split('/')
    .filter(segment => segment && segment !== '.' && segment !== '..')
    .map(segment => segment.replace(/[^a-zA-Z0-9_.-]/g, '_'));
  if (segments[0]?.toLowerCase() === 'scripts') segments.shift();
  let file = segments.join('/');
  if (!file || file === '.shader') file = 'q3edit_custom.shader';
  const withRoot = `scripts/${file}`;
  return /\.shader$/i.test(withRoot)
    ? `${withRoot.slice(0, -'.shader'.length)}.shader`
    : `${withRoot}.shader`;
}

export function validateProjectShaderFiles(files: Record<string, string>): ProjectShaderSourceValidation {
  const validations = Object.fromEntries(Object.entries(files).map(([path, source]) => [
    path,
    validateShaderSource(source),
  ]));
  const pathOwners = new Map<string, string>();
  for (const [path, validation] of Object.entries(validations)) {
    const normalized = normalizeProjectShaderPath(path);
    if (normalized !== path) {
      validation.diagnostics.push({
        line: 1,
        message: `Shader file path must be normalized as ${normalized}`,
      });
      validation.valid = false;
    }
    const pathKey = normalized.toLowerCase();
    const owner = pathOwners.get(pathKey);
    if (owner && owner !== path) {
      validation.diagnostics.push({
        line: 1,
        message: `Shader file path collides with ${owner}`,
      });
      validation.valid = false;
    } else {
      pathOwners.set(pathKey, path);
    }
  }
  const owners = new Map<string, string>();
  for (const [path, validation] of Object.entries(validations)) {
    for (const shaderName of validation.shaderNames) {
      const owner = owners.get(shaderName);
      if (!owner) {
        owners.set(shaderName, path);
        continue;
      }
      validation.diagnostics.push({
        line: 1,
        message: `Duplicate shader across project files: ${shaderName} (also in ${owner})`,
      });
      validation.valid = false;
    }
  }
  return {
    valid: Object.values(validations).every(validation => validation.valid),
    files: validations,
  };
}

export function defaultProjectShaderSource(name = 'q3edit/custom'): string {
  return `textures/${name}\n{\n  qer_editorimage textures/base_wall/concrete\n  {\n    map textures/base_wall/concrete\n  }\n}\n`;
}
