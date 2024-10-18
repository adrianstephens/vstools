/**@type {import('eslint').Linter.Config} */
// eslint-disable-next-line no-undef
module.exports = {
	root: true,
	parser: '@typescript-eslint/parser',
	plugins: [
		'@typescript-eslint',
	],
	extends: [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
	],
	rules: {
		'semi': [2, "always"],
		'@typescript-eslint/no-misleading-character-class': 0,
		'@typescript-eslint/no-this-alias': 0,
		'@typescript-eslint/no-unused-vars': 0,
		'@typescript-eslint/no-explicit-any': 0,
		'@typescript-eslint/explicit-module-boundary-types': 0,
		'@typescript-eslint/no-non-null-assertion': 0,
	},
	overrides: [
		{
			files: ['**/*.js', '**/*.jsx'], // Specify the file patterns to ignore
			rules: {
				'no-undef': 'off',
				'@typescript-eslint/no-var-requires': 'off',
			}
		}
	]
};