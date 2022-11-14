// SPDX-FileCopyrightText: 2021 Anders Rune Jensen
//
// SPDX-License-Identifier: LGPL-3.0-only

const makeEncryptionFormat = require('./format')
const monitorForest = require('./monitor')

exports.name = 'box2'

exports.init = function (ssb, config) {
  const encryptionFormat = makeEncryptionFormat()
  if (ssb.db) ssb.db.installEncryptionFormat(encryptionFormat)

  if (config.box2 && config.box2.legacyMode) {
    encryptionFormat.addSigningKeys(config.keys)
  } else {
    encryptionFormat.disableLegacyMode()
    // Wait a bit for other secret-stack plugins (ssb-meta-feeds) to load
    setTimeout(() => {
      if (!ssb.metafeeds) {
        throw new Error('ssb-box2 requires ssb-meta-feeds plugin')
      } else {
        monitorForest(ssb, encryptionFormat)
      }
    }, 1)
  }

  return {
    setOwnDMKey: encryptionFormat.setOwnDMKey,
    addSigningKeys: encryptionFormat.addSigningKeys,
    addGroupInfo: encryptionFormat.addGroupInfo,
    listGroupIds: encryptionFormat.listGroupIds,
    getGroupKeyInfo: encryptionFormat.getGroupKeyInfo,
  }
}
