const csharpFunctionSignature = /(?:(?<modifiers>\b(?:public|private|protected|internal|static|virtual|override|sealed|abstract|async)\b\s*)*)\b(?<returnType>\S+)\b\s*(?<methodName>\w+)\s*\((?<parameters>(?:\b(?:ref|out|params)\b\s*)?(?:\b\S+\b\s+\b\w+\b\s*(?:,\s*)?)+)?\)/g;

const convertToTypeScriptSignature = (csharpSignature) => {
  const matches = csharpSignature.matchAll(csharpFunctionSignature);
  let tsSignature = '';

  for (const match of matches) {
    const modifiers = match.groups.modifiers ? `${match.groups.modifiers} ` : '';
    const returnType = match.groups.returnType;
    const methodName = match.groups.methodName;
    const parameters = match.groups.parameters
      ? match.groups.parameters
          .split(',')
          .map((param) => {
            const [type, name] = param.trim().split(/\s+/);
            return `${name}:${type}`;
          })
          .join(', ')
      : '';

    tsSignature += `${modifiers}${methodName}(${parameters}):${returnType};`;
  }

  return tsSignature;
};

// Example usage
const csharpSignature = 'public static int Add(int x, int y)';
const tsSignature = convertToTypeScriptSignature(csharpSignature);
console.log(tsSignature); // Output: Add(x:int, y:int):int;
