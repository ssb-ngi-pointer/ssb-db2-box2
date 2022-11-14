// SPDX-FileCopyrightText: 2022 Andre 'Staltz' Medeiros
//
// SPDX-License-Identifier: LGPL-3.0-only

const { promisify } = require('util')
const BFE = require('ssb-bfe')
const Ref = require('ssb-ref')
const Uri = require('ssb-uri2')
const path = require('path')
const os = require('os')
const { box, unbox } = require('envelope-js')
const { SecretKey, DHKeys } = require('ssb-private-group-keys')
const { keySchemes } = require('private-group-spec')
const Keyring = require('ssb-keyring')
const { ReadyGate } = require('./utils')

function reportError(err) {
  if (err) console.error(err)
}

const ATTEMPT1 = { maxAttempts: 1 }
const ATTEMPT16 = { maxAttempts: 16 }

function makeEncryptionFormat() {
  let keyring = null
  const keyringReady = new ReadyGate()
  let legacyMode = true
  let mainKeys = null

  function setup(config, cb) {
    const keyringPath = path.join(
      config.path || path.join(os.tmpdir(), '.ssb-keyring-' + Date.now()),
      'keyring'
    )
    Keyring(keyringPath, (err, api) => {
      if (err) return cb(err)
      keyring = api
      mainKeys = config.keys
      keyringReady.setReady()
      cb()
    })
  }

  function teardown(cb) {
    keyringReady.onReady(() => {
      keyring.close(cb)
    })
  }

  function disableLegacyMode() {
    legacyMode = false
  }

  function isPrimordialGroup(recp) {
    return (
      recp &&
      recp.scheme === keySchemes.private_group &&
      Buffer.isBuffer(recp.key)
    )
  }

  function isGroupId(recp) {
    return keyring.group.has(recp)
  }

  function isFeed(recp) {
    return (
      Ref.isFeed(recp) ||
      Uri.isClassicFeedSSBURI(recp) ||
      Uri.isBendyButtV1FeedSSBURI(recp) ||
      Uri.isButtwooV1FeedSSBURI(recp)
    )
  }

  function setOwnDMKey(key) {
    keyringReady.onReady(() => {
      keyring.self.set({ key }, reportError)
    })
  }

  function addDMPair(myKeys, theirId) {
    const myDhKeysBFE = new DHKeys(myKeys, { fromEd25519: true })
    const theirKeys = { public: BFE.encode(theirId).slice(2) }
    const theirDhKeysBFE = new DHKeys(theirKeys, { fromEd25519: true })
    keyringReady.onReady(() => {
      keyring.dm.add(
        myKeys.id,
        theirId,
        myDhKeysBFE,
        theirDhKeysBFE,
        reportError
      )
    })
  }

  function addDMTriangle(xRootId, xLeafId, yLeafId) {
    keyringReady.onReady(() => {
      keyring.dm.addTriangle(xRootId, xLeafId, yLeafId, reportError)
    })
  }

  function addSigningKeys(keys, name) {
    keyringReady.onReady(() => {
      if (name) keyring.signing.addTagged(name, keys)
      else keyring.signing.add(keys)
    })
  }

  function getRootSigningKey(cb) {
    keyringReady.onReady(() => {
      cb(null, keyring.signing.get('root'))
    })
  }

  function addGroupInfo(id, info) {
    keyringReady.onReady(() => {
      keyring.group.add(id, info, reportError)
    })
  }

  function listGroupIds(cb) {
    if (cb === undefined) return promisify(listGroupIds)()

    keyringReady.onReady(() => {
      cb(null, keyring.group.list())
    })
  }

  function getGroupKeyInfo(groupId, cb) {
    if (cb === undefined) return promisify(getGroupKeyInfo)(groupId)

    if (!groupId) cb(new Error('Group id required'))

    keyringReady.onReady(() => {
      cb(null, keyring.group.get(groupId))
    })
  }

  function dmEncryptionKey(authorKeys, recp) {
    const err = new Error('DM keys not supported for recipient ' + recp)
    if (legacyMode) {
      if (!keyring.dm.has(authorKeys.id, recp)) addDMPair(authorKeys, recp)
      const dmKeys = keyring.dm.get(authorKeys.id, recp)
      if (!dmKeys) throw err
      return dmKeys
    } else {
      const theirRootId = recp
      const myLeafId = authorKeys.id
      const theirLeafId = keyring.dm.triangulate(theirRootId, myLeafId)
      if (!theirLeafId) throw err
      const dmKeys = keyring.dm.get(myLeafId, theirLeafId)
      if (!dmKeys) throw err
      return dmKeys
    }
  }

  function encrypt(plaintextBuf, opts) {
    const recps = opts.recps
    const authorId = opts.keys.id
    const previousId = opts.previous

    const encryptionKeys = recps.map((recp) => {
      if (isPrimordialGroup(recp)) {
        return recp
      } else if (recp === authorId || keyring.signing.has(recp)) {
        return keyring.self.get()
      } else if (isFeed(recp)) {
        return dmEncryptionKey(opts.keys, recp)
      } else if (isGroupId(recp) && keyring.group.has(recp)) {
        return keyring.group.get(recp)
      } else throw new Error('Unsupported recipient: ' + recp)
    })

    const validCount = encryptionKeys.length
    if (validCount === 0) {
      throw new Error(`no box2 keys found for recipients: ${recps}`)
    }
    if (validCount > 16) {
      // prettier-ignore
      throw new Error(`private-group spec allows maximum 16 slots, but you've tried to use ${validCount}`)
    }

    const validGroupCount = encryptionKeys.filter(
      (encryptKeys) => encryptKeys.scheme === keySchemes.private_group
    ).length
    if (validGroupCount > 1) {
      // prettier-ignore
      throw new Error(`private-group spec only supports one group recipient, but you've tried to use ${validGroupCount}`)
    }

    const msgSymmKey = new SecretKey().toBuffer()
    const authorIdBFE = BFE.encode(authorId)
    const previousMsgIdBFE = BFE.encode(previousId)

    const ciphertextBuf = box(
      plaintextBuf,
      authorIdBFE,
      previousMsgIdBFE,
      msgSymmKey,
      encryptionKeys
    )

    return ciphertextBuf
  }

  function selfDecryptionKeys(authorId) {
    const selfKeys = keyring.self.get()
    if (keyring.signing.has(authorId)) return [selfKeys]
    else if (legacyMode && authorId === mainKeys.id) return [selfKeys]
    else return []
  }

  function dmDecryptionKeys(authorId) {
    if (legacyMode) {
      const dmKeys = keyring.dm.get(mainKeys.id, authorId)
      if (!dmKeys) addDMPair(mainKeys, authorId)
      if (!keyring.dm.has(mainKeys.id, authorId)) return []
      return [keyring.dm.get(mainKeys.id, authorId)]
    } else {
      const myRootKeys = keyring.signing.get('root')
      if (!myRootKeys) return []
      const myLeafId = keyring.dm.triangulate(myRootKeys.id, authorId)
      if (!myLeafId) return []
      if (!keyring.dm.has(myLeafId, authorId)) return []
      return [keyring.dm.get(myLeafId, authorId)]
    }
  }

  function decrypt(ciphertextBuf, opts) {
    const authorId = opts.author
    const authorBFE = BFE.encode(authorId)
    const previousBFE = BFE.encode(opts.previous)

    const group = keyring.group.list().map(keyring.group.get)
    const self = selfDecryptionKeys(authorId)
    const dm = dmDecryptionKeys(authorId)

    const unboxWith = unbox.bind(null, ciphertextBuf, authorBFE, previousBFE)

    let plaintextBuf = null

    if ((plaintextBuf = unboxWith(group, ATTEMPT1))) return plaintextBuf
    if ((plaintextBuf = unboxWith(self, ATTEMPT16))) return plaintextBuf
    if ((plaintextBuf = unboxWith(dm, ATTEMPT16))) return plaintextBuf

    return null
  }

  return {
    // ssb-encryption-format API:
    name: 'box2',
    setup,
    teardown,
    encrypt,
    decrypt,
    // ssb-box2 specific APIs:
    setOwnDMKey,
    addGroupInfo,
    listGroupIds,
    getGroupKeyInfo,
    // Internal APIs:
    addSigningKeys,
    addDMPair,
    addDMTriangle,
    getRootSigningKey,
    disableLegacyMode,
  }
}

module.exports = makeEncryptionFormat
