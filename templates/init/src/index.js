/**
 * Runs in the Yapin’ page when __NAME__ starts, before plugins do.
 * `client` is everything the framework offers: client.pages, client.plugins, client.themes,
 * client.badges, client.api, client.about, client.ui… (see docs/runtime.md).
 *
 * @param {import('yapin.js-client/runtime').Client} client
 */
export default function setup(client) {
  client.logger.info(`${client.name} ${client.version} starting`);
}
