// Everything else lives in app.json. This file only exists because
// google-services.json is kept out of git: EAS builds get it from the
// GOOGLE_SERVICES_JSON file variable, local builds read it from disk.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
