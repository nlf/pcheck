#!/usr/bin/env node
var request = require('request'),
    semver = require('semver'),
    async = require('async'),
    fs = require('fs'),
    exec = require('child_process').exec;

// first we load the package.json and get a list of everything saved in the requires
var config_filename, config, configured_packages = {};
config_filename = process.cwd() + '/package.json';
if (!fs.existsSync(config_filename)) {
    console.log('ERROR: No package.json file exists in this directory');
    process.exit(1);
}
config = require(config_filename);
[config.dependencies, config.devDependencies].forEach(function (p) {
    if (!p) return;
    Object.keys(p).forEach(function (pack) {
        configured_packages[pack] = p[pack];
    });
});

// then we run an npm ls --json to see what's actually installed
var installed_packages = {},
    missing_packages = [],
    deps;
exec('npm ls --json', function (err, stdout, stderr) {
    // iterate over installed packages, we're only checking first level stuff
    deps = JSON.parse(stdout).dependencies;
    Object.keys(deps).forEach(function (p) {
        if (deps[p].missing) {
            missing_packages.push(p);
        } else {
            installed_packages[p] = deps[p].version;
        }
    });

    // if we're missing packages, tell the user to install them before continuing
    if (missing_packages.length) {
        console.log('ERROR: The following packages are not installed: ' + missing_packages.join(', '));
        console.log('ERROR: Please run npm install before using pcheck');
        process.exit(1);
    }

    // now we'll do our first check, and make sure that all installed packages are configured
    compareLists(configured_packages, installed_packages, function (notconfigured) {
        if (notconfigured) {
            console.log('WARN: The following packages are installed, but do not exist in package.json: ' + notconfigured.join(', '));
        }
        // and then we'll check versions
        checkUpdates(configured_packages, installed_packages, function (updates) {
            if (updates) {
                updates.forEach(function (update) {
                    console.log('WARN: Package: %s, installed version: %s, latest available version: %s', update.name, update.installed, update.available);
                });
            }
        });
    });
});

function compareLists(configured, installed, callback) {
    var notconfigured = [];

    // let's see what packages are installed, but not configured
    var installed_keys = Object.keys(installed),
        configured_keys = Object.keys(configured);

    installed_keys.forEach(function (key) {
        if (!~configured_keys.indexOf(key)) {
            notconfigured.push(key);
        }
    });

    callback(notconfigured.length ? notconfigured : null);
}

function checkUpdates(configured, installed, callback) {
    var updates = [];
    async.eachLimit(Object.keys(installed), 5, function (package, cb) {
        if (!configured.hasOwnProperty(package)) return cb();
        if (!semver.validRange(configured[package])) return cb();
        request.get({ uri: 'https://registry.npmjs.org/' + package + '/latest', json: true }, function (error, res, body) {
            if (error) {
                console.log('ERROR: Failed to check package version for ' + package);
                return cb();
            }
            if (semver.gt(body.version, installed[package])) {
                updates.push({ name: package, installed: installed[package], available: body.version });
            }
            cb();
        });
    }, function (err) {
        callback(updates.length ? updates : null);
    });
}
