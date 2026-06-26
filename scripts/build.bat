@echo off
setlocal

echo Starting build process...

cd ../

if exist dist\nat-bridge.exe del dist\nat-bridge.exe

echo Cleaning previous build artifacts...
del package-lock.json

rmdir node_modules /s /q

echo Installing dependencies...
call npm install

echo Cleaning up unnecessary files...
call modclean -r -f
call npx clean-modules -y

echo Building executable with caxa...

call npx caxa --input . --exclude "scripts/**" "icons/**" "dist/**" "bin/**" "node_modules/caxa/stubs/**" "node_modules/rcedit/**" "launcher/**" "static/**" "nat-bridge.exe" "configuration examples/**" "VERSION" "README.md" "LICENSE" --output bin\nat-bridge.exe --uncompression-message "Unpacking... this may take some time." -- "{{caxa}}/node_modules/.bin/node" "{{caxa}}/main.js"

echo Build complete! Executable located at bin\nat-bridge.exe
