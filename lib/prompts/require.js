var tools = require( '../util/prompt-tools' );
var path = require( 'path' );

var requirePrompts = {
	questions: [
		{
			type: 'list',
			name: 'type',
			message: 'This dependency is a:',
			choices: [
				{
					name: 'WP Plugin',
					value: 'plugin'
				},
				{
					name: 'WP Theme',
					value: 'theme'
				},
				{
					name: 'WP MU Plugin',
					value: 'muplugin'
				},
				new tools.inquirer.Separator(),
				{
					name: 'No more, I\'m done',
					value: 'done'
				}
			]
		},
		{
			when: tools.makeWhen( 'done', 'type', true ),
			type: 'list',
			name: 'source',
			message: 'This dependency is:',
			choices: [
				{
					name: 'In the .org repository.',
					value: 'wpackagist'
				},
				{
					name: 'Version controlled (git or svn).',
					value: 'vcs'
				},
				{
					name: 'In the packagist repository.',
					value: 'packagist'
				},
				{
					name: 'In a zip file or tar ball.',
					value: 'ziptar'
				}
			]
		},
		{
			when: tools.makeWhen( 'wpackagist', 'source' ),
			name: 'slug',
			message: 'The .org slug is:'
		},
		{
			when: tools.makeWhen( [ 'vcs', 'ziptar' ], 'source' ),
			name: 'url',
			message: 'The dependency URL is:',
		},
		{
			when: tools.makeWhen( 'vcs', 'source' ),
			type: 'confirm',
			name: 'hasJSON',
			message: 'The repository contains a composer.json file:'
		},
		{
			when: tools.makeWhen( [ 'packagist', 'vcs', 'ziptar' ], 'source' ),
			name: 'name',
			message: 'The package name is:',
		},
		{
			when: tools.makeWhen( 'done', 'type', true ),
			name: 'version',
			message: 'The version to install:',
			filter: tools.filterLatest,
			default: 'latest'
		},
		{
			when: tools.makeWhen( 'done', 'type', true ),
			type: 'confirm',
			name: 'confirmed',
			message: 'Alright, I got it. Is everything correct?'
		}
	],
	answers: tools._.curry( processAnswers )
};

function processAnswers( context, done, answers ) {
	if ( 'done' === answers.type ) {
		return done();
	}

	if ( ! answers.confirmed ) {
		context.log( tools.chalk.red.bold( 'OK, let\'s try again.' ) );
		context.prompt( requirePrompts.questions, requirePrompts.answers( context, done ) );
		return;
	}

	var composerRepo = {},
		requireName;

	if ( 'vcs' === answers.source || 'ziptar' === answers.source ) {
		if ( 'vcs' === answers.source && answers.hasJSON ) {
			composerRepo.type = 'vcs';
			composerRepo.url = answers.url;
		} else {
			composerRepo.type = 'package';
			composerRepo.package = {
				name: answers.name,
				version: answers.version,
				type: 'wordpress-' + answers.type
			};
			composerRepo.package[ ( answers.hasJSON ) ? 'source' : 'dist' ] = {
				url: answers.url,
				type: ( 'ziptar' === answers.source ) ? path.extname( answers.url ) : 'vcs'
			};
		}
		context.install.composer.repositories.push( composerRepo );
	}

	if ( 'wpackagist' === answers.source ) {
		requireName = 'wpackagist-' + answers.type + '/' + answers.slug;
	} else {
		requireName = answers.name;
	}

	context.install.composer.require[ requireName ] = answers.version;

	context.log( tools.chalk.green.bold( 'All right, your dependency has been noted!' ) );
	context.log( tools.chalk.magenta( 'Want to add another?' ) );
	context.prompt( requirePrompts.questions, requirePrompts.answers( context, done ) );
}

module.exports = requirePrompts;