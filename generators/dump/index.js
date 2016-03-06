var Base = require( '../../lib/base' );
var _ = require( 'lodash' );
var path = require( 'path' );
var envParse = require( 'dotenv' ).parse;
var crypto = require( 'crypto' );
var chalk = require( 'chalk' );


module.exports = Base.extend({
	dumpMap: {
		'vmanifest': '_dumpVManifest',
		'composer': '_dumpComposer',
		'env': '_dumpEnv',
		'domains': '_dumpDomains',
		'wp-cli': '_dumpWPCLI',
		'package': '_dumpPackage',
		'nginx-config': '_dumpNginxConfig'
	},
	_initialize: function() {
		this.arguments.forEach( this._processDump.bind( this ) );
	},
	_processDump: function ( dump ) {
		if ( this.dumpMap[ dump ] ) {
			this.addRunMethod(
				'dump:' + dump,
				this.wrapDone( this[ this.dumpMap[ dump ] ] ),
				'writing'
			);
		}
		if ( 'all' === dump ) {
			_.keys( this.dumpMap ).forEach( this._processDump.bind( this ) );
		}
	},
	_dumpVManifest: function() {
		this.writeJSON( _.omit( this.install, [ 'workingDirectory' ] ), 'vmanifest.json' );
	},
	_dumpComposer: function() {
		// Localize vars.
		var composer;
		if ( ! this.install.composer ) {
			this.log(
				chalk.yellow( 'Composer is turned for this site in the manifest.' )
			);
			return;
		}

		// Copy and mutate install data into composer json.
		composer = _.chain( this.install )
			.assign( this.install.composer )
			.omit( [ 'in-app', 'site', 'server', 'src', 'composer', 'workingDirectory' ] )
			.merge( this._processComposerPaths( this.appPaths, 'app' ) )
			.value();

		// Write the composer file.
		this.writeJSON( composer, 'composer.json' );

		// Dump the app version if it's supported.
		if ( false !== this.install.composer['in-app'] ) {
			this._dumpComposerApp( composer, this.appPaths );
		}
	},
	_dumpComposerApp: function( composer, paths ) {
		var i, length, sourcesWhitlist = [ 'plugin', 'theme', 'muplugin' ];

		// clean composer object
		delete composer.extra['installer-paths'];
		delete composer.extra['wordpress-install-dir'];
		if ( composer.config && composer.config['vendor-dir'] ) {
			delete composer.config['vendor-dir'];
			if ( _.isEmpty( composer.config ) ) {
				delete composer.config;
			}
		}

		// Add each plugin, theme, and muplugin source as a dependency.
		if ( 0 < this.install.src.length ) {
			for( i = 0, length = this.install.src.length; i < length; i++ ) {
				if ( -1 !== sourcesWhitlist.indexOf( this.install.src[ i ].map ) ) {
					composer.repositories.push( _.pick( this.install.src[ i ], [ 'type', 'url' ] ) );
					composer.require[ this.install.src[ i ].name ] = this.install.src[ i ].stable;
				}
			}
		}

		// Dump the app's composer.json file.
		this.writeJSON(
			_.merge( composer, this._processComposerPaths( paths ) ),
			path.join( 'app', paths['composer-path'], 'composer.json' )
		);
	},
	_processComposerPaths: function( paths, root ) {
		root = root || '.';

		var composerPaths = { extra: { 'installer-paths': {} } },
			themePath = path.normalize( path.join( root, paths['theme-path'], '{$name}' ) ),
			pluginPath = path.normalize( path.join( root, paths['plugin-path'], '{$name}' ) ),
			muPluginPath = path.normalize( path.join( root, paths['mu-plugin-path'], '{$name}' ) ),
			wpPath = path.normalize( path.join( root, paths['wp-path'] ) ),
			vendorDir = path.normalize( path.join( root, path.relative( paths['composer-path'], paths['vendor-dir'] ) ) );
		// Set up extras
		composerPaths.extra['wordpress-install-dir'] = wpPath;
		composerPaths.extra['installer-paths'][ themePath ] = [ 'type:wordpress-theme' ];
		composerPaths.extra['installer-paths'][ pluginPath ] = [ 'type:wordpress-plugin' ];
		composerPaths.extra['installer-paths'][ muPluginPath ] = [ 'type:wordpress-muplugin' ];
		// set up config as needed
		if ( 'vendor' !== vendorDir ) {
			composerPaths.config = { 'vendor-dir': vendorDir };
		}

		return composerPaths;
	},
	_dumpEnv: function() {
		// Localize vars
		var env, envExample, basicItems, salts,
			envPath = this.destinationPath( ( this.install.site['external-env'] ) ? '.' : 'app' );

		// Compile basic items into an object.
		basicItems = {
			SITE_TITLE: this.install.title,
			TABLE_PREFIX: this.install.site.prefix || 'wp_',
		};
		if ( this.install.site.constants.MULTISITE ) {
			basicItems.INSTALL_BASE = this.install.site.base || '/';
		}

		// Set up salts
		try {
			salts = this._generateSalts( envParse( this.fs.read( path.join( envPath, '.env' ) ) ) );
		} catch( e ) {
			salts = this._generateSalts();
		}

		// Compile the environment file string.
		env = _.chain( this.install.site.constants )
			.mapKeys( function ( item, key ) { return 'WPCONST_' + key; } )
			.assign( basicItems )
			.assign( this.install.site.env )
			.assign( salts )
			.value();


		// example key vars.
		envExample = _.assign( _.clone( env ), this._generateSalts( {}, 'your_key_here' ) );

		// Dump the .env and .env.example files.
		this.fs.write( path.join( envPath, '.env' ), this._envToString( env ) );
		this.fs.write( path.join( envPath, '.env.example' ), this._envToString( envExample ) );
	},
	_envToString: function ( envObj ) {
		return _.map( envObj, function ( item, key ) { return key + '=' + item; } ).join( "\n" );
	},
	_generateSalts: function ( envObj, genFunc ) {
		var keys = [
			'WPCONST_AUTH_KEY',
			'WPCONST_SECURE_AUTH_KEY',
			'WPCONST_LOGGED_IN_KEY',
			'WPCONST_NONCE_KEY',
			'WPCONST_AUTH_SALT',
			'WPCONST_SECURE_AUTH_SALT',
			'WPCONST_LOGGED_IN_SALT',
			'WPCONST_NONCE_SALT',
		];

		envObj = envObj || {};

		if ( undefined === genFunc ) {
			genFunc = function(){ return crypto.randomBytes(64).toString('base64'); };
		} else if ( 'function' !== typeof genFunc ) {
			var genFuncVal = genFunc;
			genFunc = function(){ return genFuncVal; };
		}

		return _.zipObject( keys, _.map( keys, function( key ){
			return envObj[ key ] || genFunc( key );
		} ) );
	},
	_dumpDomains: function() {
		// Make sure CLI gets porcessed as well.
		this._processDump( 'wp-cli' );
		this._processDump( 'nginx' );

		// Dump the hosts and nginx config files.
		this.globalTemplate( '_vvv-hosts', 'config/vvv-hosts', {
			domains: this._getDomains().join( "\n" )
		} );
	},
	_getDomains: function() {
		// process out an array of local domains.
		return [ this.install.server.local ].concat(
			( this.install.server.subdomains || [] )
			.map( _mapSubs, this )
		);

		function _mapSubs( sub ) {
			return sub + '.' + this.install.server.local;
		}
	},
	_dumpNginxConfig: function() {
		this.globalTemplate( '_vvv-nginx.conf', 'vvv-nginx.conf', {
			domains: this._getDomains().join( ' ' ),
			path: path.posix.normalize( path.join( 'app', this.install.server.root || '.' ) ),
			proxy: !! this.install.server.proxies
		} );
		if ( !! this.install.server.proxies ) {
			this.globalTemplate(
				'_proxy.conf',
				'config/proxy.conf',
				{
					proxies: this._normalizeProxies(
						this.install.server.proxies,
						this.install.server.remote
					),
					prefix: this.install.site.constants.DB_NAME
				}
			);
		} else {
			this.fs.delete( this.destinationPath( 'config/proxy.conf' ) );
		}
	},
	_normalizeProxies: function( proxies, fallbackURL ) {
		proxies = _.clone( proxies );
		fallbackURL = ( fallbackURL ) ? 'https://' + fallbackURL : false;

		return _.mapValues( proxies, _.curry( _singleProxyNormalize )( _, fallbackURL ) );

		function _singleProxyNormalize( proxy, fallbackURL ) {
			var types, typesExclude, normalized = {},
				defaultTypes = [
					'js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'ico',
					'mp3', 'mov', 'tif', 'tiff', 'swf', 'txt', 'html'
				];

			// If a falsey is passed, this proxy is off, keep it false.
			if ( ! proxy ) {
				return false;
			}

			// Assume simply string are meant to be the proxy URL and default the rest.
			if ( 'string' === typeof proxy ) {
				proxy = { proxies: [ proxy ] };
			}

			// Verify we have an object now.
			proxy = ( 'object' === typeof proxy ) ? proxy : {};
			if ( ! ( proxy.proxies instanceof Array ) || 0 === proxy.proxies.length ) {
				proxy.proxies = [ fallbackURL ];
			}

			// Normalize the location values, bail if we have no valid locations.
			normalized.proxies = _.compact(
				proxy.proxies.map(
					_.curry( normalizeLocations )( _, fallbackURL )
				)
			);
			if ( 0 > normalized.proxies.length ) {
				return false;
			}

			// Process out the match value.
			if ( proxy.match && 'string' === typeof proxy.match ) {
				normalized.match = proxy.match;
			} else {
				// Add types to the default array if needed.
				if ( proxy['types-include'] instanceof Array ) {
					defaultTypes = _.uniq( defaultTypes.concat( proxy['types-include'] ) );
				}
				// Process types out into a final match string.
				types = ( proxy.types instanceof Array ) ? proxy.types : defaultTypes;
				typesExclude = ( proxy['types-exclude'] instanceof Array ) ? proxy['types-exclude'] : [];
				normalized.match = '\\.(' + _.without( types, typesExclude ).join( '|' ) + ')$';
			}

			return normalized;

			function normalizeLocations( location, fallbackURL ) {
				if ( 'string' === typeof location ) {
					location = {
						rewrite: false,
						url: location
					};
				} else if ( 'object' === typeof location ) {
					location = {
						rewrite: ( 'string' === typeof location.rewrite ) ? location.rewrite : false,
						url: ( 'string' === typeof location.url ) ? location.url : fallbackURL
					};
				} else {
					location = false;
				}
				return location;
			}
		}
	},
	_dumpWPCLI: function() {
		// Compile basic data.
		var data = {
			title: this.install.title,
			url: this.install.server.local,
			user: this.install.site['admin-user'] || 'admin',
			pass: this.install.site['admin-pass'] || 'password',
			email: this.install.site['admin-email'] || 'admin@' + this.install.server.local,
		};

		// Compile the WP directory path.
		if ( this.install.composer.app ) {
			data.path = path.join( 'app', this.install.composer.app['wp-path'] || 'wp' );
		} else {
			data.path = path.join( 'app', 'wp' );
		}

		// Dump the wp-cli.yml file.
		this.globalTemplate( '_wp-cli.yml', 'wp-cli.yml', data );
	},
	_dumpPackage: function() {
		this.writeJSON( {
			name: this.install.site.constants.DB_NAME,
			version: this.install.version,
			description: this.install.description,
			license: this.install.license,
			main: 'Gruntfile.js',
			scripts: {
				test: 'echo "Error: no test specified" && exit 1'
			},
			dependencies: {
				'grunt': '^0.4.5',
				'grunt-confirm': '^1.0.4',
				'grunt-contrib-clean': '^0.7.0',
				'grunt-contrib-copy': '^1.0.0',
				'grunt-gitpull': '^0.3.0',
				'grunt-hardlink': '^0.2.0',
				'grunt-http': '^2.0.0',
				'grunt-svn-checkout': '^0.3.0',
				'grunt-vagrant-commands': '^0.1.0',
				'load-grunt-config': '^0.17.2'
			}
		}, 'package.json' );
	},
	allowRun: function(){}
});