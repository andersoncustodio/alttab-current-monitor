#!/usr/bin/env bash

DIR="alttab-current-monitor@andersoncustodio.com"

rm -f "$DIR.zip"
rm -rf "$DIR"
mkdir "$DIR"

cp metadata.json "$DIR"
cp *.js "$DIR"
cp stylesheet.css "$DIR"
cp LICENSE NOTICE README.md "$DIR"
zip -jr "$DIR.zip" "$DIR"

rm -rf "$DIR"

