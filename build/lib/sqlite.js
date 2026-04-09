import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readConfigSync } from "#core/config";
import ExternalResourceBuilder from "#core/external-resource-builder";
import fetch from "#core/fetch";
import { glob } from "#core/glob";
import Zip from "#core/zip";

const SQLITE_VERSION = "3.53.0", // NOTE: set to null to use latest available SQLite version
    SQLITE_DOMAIN = "www3.sqlite.org";

export default class ExternalResource extends ExternalResourceBuilder {
    #cwd;
    #betterSqlite3Version;
    #sqliteVersion;
    #sqliteUrl;

    constructor ( cwd ) {
        super( {
            "id": "corejslib/sqlite",
            "node": true,
            "caller": import.meta.url,
        } );

        this.#cwd = cwd;

        this.#betterSqlite3Version = "v" + readConfigSync( this.#cwd + "/package.json" ).version;
    }

    // protected
    async _getEtag () {
        const res = await this.#getSqliteVersion();

        if ( !res.ok ) return res;

        return result( 200, "better-sqlite3:" + this.#betterSqlite3Version + ",sqlite:" + this.#sqliteVersion );
    }

    async _build ( location ) {
        var res;

        // update sqlite sources
        res = await this.#updateSqlite();
        if ( !res.ok ) return res;

        // patch
        res = childProcess.spawnSync( 'sed -i -e "/SQLITE_USE_URI=0/ s/=0/=1/" deps/defines.gypi', {
            "cwd": this.#cwd,
            "shell": true,
            "stdio": "inherit",
        } );
        if ( res.status ) return result( 500 );

        // build for current nodejs version
        res = childProcess.spawnSync( "npm run build-release", {
            "cwd": this.#cwd,
            "shell": true,
            "stdio": "inherit",
        } );
        if ( res.status ) return result( 500 );

        const files = await glob( "build/Release/better_sqlite3.node", { "cwd": this.#cwd } );

        if ( !files.length ) return result( 500 );

        fs.copyFileSync( this.#cwd + "/" + files[ 0 ], location + "/sqlite.node" );

        return result( 200 );
    }

    async _getMeta () {
        return result( 200, {
            "better-sqlite3": this.#betterSqlite3Version,
            "sqlite": this.#sqliteVersion,
        } );
    }

    // private
    async #getSqliteVersion () {
        if ( SQLITE_VERSION ) {
            const sqliteYear = new Date().getFullYear(),
                sqliteProductVersion =
                    SQLITE_VERSION.split( "." )
                        .map( ( label, idx ) => ( !idx
                            ? label
                            : label.padStart( 2, "0" ) ) )
                        .join( "" ) + "00";

            this.#sqliteVersion = "v" + SQLITE_VERSION;

            this.#sqliteUrl = `https://${ SQLITE_DOMAIN }/${ sqliteYear }/sqlite-amalgamation-${ sqliteProductVersion }.zip`;
        }
        else {
            const res = await fetch( `https://${ SQLITE_DOMAIN }/download.html` );
            if ( !res.ok ) return result( [ res.status, "Get version error: " + res.statusTexsd ] );

            const html = await res.text(),
                match = html.match( /(\d{4}\/sqlite-amalgamation-(3\d{6}).zip)/ );

            this.#sqliteVersion =
                "v" +
                match[ 2 ]
                    .split( /(\d)(\d\d)(\d\d)/ )
                    .slice( 1, 4 )
                    .map( label => +label )
                    .join( "." );

            this.#sqliteUrl = `https://${ SQLITE_DOMAIN }/` + match[ 1 ];
        }

        return result( 200 );
    }

    async #updateSqlite () {
        var res;

        res = await fetch( this.#sqliteUrl );

        if ( !res.ok ) return result( [ res.status, "Download error: " + res.statusTexsd ] );

        const location = this.#cwd + "/deps";

        fs.mkdirSync( location, {
            "recursive": true,
        } );

        fs.writeFileSync( location + "/sqlite3.zip", await res.buffer() );

        const zip = new Zip( path.join( this.#cwd, "deps/sqlite3.zip" ) );

        for ( const entry of zip.getEntries() ) {
            if ( !entry.name ) continue;

            fs.writeFileSync( path.join( this.#cwd, "deps/sqlite3", entry.name ), entry.getData() );
        }

        return result( 200 );
    }
}
