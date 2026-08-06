@echo off
echo Starting Attendance App Server via Vite...
echo.
echo Please wait while the development server starts.
echo It will open automatically in your primary browser.
echo.
REM The user-level ~/.npmrc may omit devDependencies; --include=dev ensures Vite installs.
npm install --include=dev && npm run dev
pause
