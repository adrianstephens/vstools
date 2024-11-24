const csharpFunctionSignature = /(?:(?<modifiers>\b(?:public|private|protected|internal|static|virtual|override|sealed|abstract|async)\b\s*)*)\b(?<returnType>\S+)\b\s*(?<methodName>\w+)\s*\((?<parameters>(?:\b(?:ref|out|params)\b\s*)?(?:\b\S+\b\s+\b\w+\b\s*(?:,\s*)?)+)?\)/g;
const csharpParameterRegex = /\b(?:ref|out|params)?\b\s*(?<type>\S+)\s+(?<name>\w+)/g;

const convertToTypeScriptSignature = (csharpSignature) => {
  const matches = csharpSignature.matchAll(csharpFunctionSignature);
  let tsSignature = '';

  for (const match of matches) {
    const modifiers = match.groups.modifiers ? `${match.groups.modifiers} ` : '';
    const returnType = match.groups.returnType;
    const methodName = match.groups.methodName;
    const parameters = match.groups.parameters
      ? match.groups.parameters
          .replace(csharpParameterRegex, (_, type, name) => `${name}:${type}`)
      : '';

    tsSignature += `${modifiers}${methodName}(${parameters}):${returnType};`;
  }

  return tsSignature;
};

log('hello'); // Output: Add(x:int, y:double, values:string[]):int;

// Example usage
const csharpSignature = 'public static int Add(int x, ref double y, params string[] values)';
const tsSignature = convertToTypeScriptSignature(csharpSignature);
log('it is:'+tsSignature); // Output: Add(x:int, y:double, values:string[]):int;
