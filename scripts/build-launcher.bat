@echo off
setlocal

echo Starting build process...
cd ./launcher

echo Cleaning previous build artifacts...
del package-lock.json

rmdir node_modules /s /q

echo Installing dependencies...
call npm install

echo Cleaning up unnecessary files...
call modclean -r -f
call npx clean-modules -y

echo Building executable with caxa...

call caxa --input . --output ../bin/launcher.exe --uncompression-message "Unpacking... this may take some time." -- "{{caxa}}/node_modules/.bin/node" "-e" "const {spawn}=require('child_process'); const node=String.raw`{{caxa}}/node_modules/.bin/node`.replace(/\//g,'\\'); const child=spawn(node,[String.raw`{{caxa}}/nat-bridge-launcher.js`],{windowsHide:true,detached:true,stdio:'ignore'}); child.unref(); process.exit(0);"
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Tools\MSVC\14.44.35207\bin\Hostx64\x64\editbin.exe" /SUBSYSTEM:WINDOWS bin\nat-bridge.exe

echo Build complete! Executable located at bin\launcher.exe
