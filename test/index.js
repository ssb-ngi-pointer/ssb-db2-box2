// SPDX-FileCopyrightText: 2021 Anders Rune Jensen
//
// SPDX-License-Identifier: Unlicense

const test = require('tape')
const { check } = require('ssb-encryption-format')
const ssbKeys = require('ssb-keys')
const buttwoo = require('ssb-buttwoo/format')
const { keySchemes } = require('private-group-spec')

const Box2 = require('../format')

test('passes ssb-encryption-format', (t) => {
  const box2 = Box2()
  check(
    box2,
    () => {
      box2.setOwnDMKey(
        Buffer.from(
          '30720d8f9cbf37f6d7062826f6decac93e308060a8aaaa77e6a4747f40ee1a76',
          'hex'
        )
      )
    },
    (err) => {
      t.error(err, 'no error')
      if (err) console.log(err)
      t.end()
    }
  )
})

test('decrypt as DM recipient from own encrypted DM', (t) => {
  const box2 = Box2()
  const keys = ssbKeys.generate(null, 'alice', 'buttwoo-v1')

  box2.setup({ keys }, () => {
    box2.setOwnDMKey(
      Buffer.from(
        '30720d8f9cbf37f6d7062826f6decac93e308060a8aaaa77e6a4747f40ee1a76',
        'hex'
      )
    )

    const opts = {
      keys,
      content: { type: 'post', text: 'super secret' },
      previous: null,
      timestamp: 12345678900,
      tag: buttwoo.tags.SSB_FEED,
      hmacKey: null,
      recps: [keys.id, ssbKeys.generate(null, '2').id],
    }

    const plaintext = buttwoo.toPlaintextBuffer(opts)
    t.true(Buffer.isBuffer(plaintext), 'plaintext is a buffer')

    const ciphertext = box2.encrypt(plaintext, opts)

    const decrypted = box2.decrypt(ciphertext, { ...opts, author: keys.id })
    t.deepEqual(decrypted, plaintext, 'decrypted plaintext is the same')

    t.end()
  })
})

test('decrypt as DM recipient from shared DM keys', (t) => {
  const box2 = Box2()
  const keys1 = ssbKeys.generate(null, 'alice', 'buttwoo-v1')
  const keys2 = ssbKeys.generate(null, 'bob', 'buttwoo-v1')

  box2.setup({ keys: keys2 }, (err) => {
    t.error(err, 'no error')

    box2.setOwnDMKey(
      Buffer.from(
        '30720d8f9cbf37f6d7062826f6decac93e308060a8aaaa77e6a4747f40ee1a76',
        'hex'
      )
    )

    const opts = {
      keys: keys2,
      content: { type: 'post', text: 'super secret' },
      previous: null,
      timestamp: 12345678900,
      tag: buttwoo.tags.SSB_FEED,
      hmacKey: null,
      recps: [keys2.id, keys1.id],
    }

    const plaintext = buttwoo.toPlaintextBuffer(opts)
    t.true(Buffer.isBuffer(plaintext), 'plaintext is a buffer')
    const ciphertext = box2.encrypt(plaintext, opts)

    box2.setup({ keys: keys1 }, (err) => {
      t.error(err, 'no error')
      const decrypted = box2.decrypt(ciphertext, { ...opts, author: keys2.id })
      t.deepEqual(decrypted, plaintext, 'decrypted plaintext is the same')

      t.end()
    })
  })
})

test('decrypt as group recipient', (t) => {
  const box2 = Box2()
  const keys = ssbKeys.generate(null, 'alice', 'buttwoo-v1')

  box2.setup({ keys }, () => {
    const groupId = '%Lihvp+fMdt5CihjbOY6eZc0qCe0eKsrN2wfgXV2E3PM=.cloaked'
    box2.addGroupInfo(groupId, {
      key: Buffer.from(
        '30720d8f9cbf37f6d7062826f6decac93e308060a8aaaa77e6a4747f40ee1a76',
        'hex'
      ),
    })

    const opts = {
      keys,
      content: { type: 'post', text: 'super secret' },
      previous: null,
      timestamp: 12345678900,
      tag: buttwoo.tags.SSB_FEED,
      hmacKey: null,
      recps: [groupId, ssbKeys.generate(null, '2').id],
    }

    const plaintext = buttwoo.toPlaintextBuffer(opts)
    t.true(Buffer.isBuffer(plaintext), 'plaintext is a buffer')

    const ciphertext = box2.encrypt(plaintext, opts)

    const decrypted = box2.decrypt(ciphertext, { ...opts, author: keys.id })
    t.deepEqual(decrypted, plaintext, 'decrypted plaintext is the same')

    t.end()
  })
})

test('cannot decrypt own DM after we changed our own DM keys', (t) => {
  const box2 = Box2()
  const keys = ssbKeys.generate(null, 'alice', 'buttwoo-v1')

  box2.setup({ keys }, () => {
    const opts = {
      keys,
      content: { type: 'post', text: 'super secret' },
      previous: null,
      timestamp: 12345678900,
      tag: buttwoo.tags.SSB_FEED,
      hmacKey: null,
      recps: [keys.id],
    }

    const plaintext = buttwoo.toPlaintextBuffer(opts)
    t.true(Buffer.isBuffer(plaintext), 'plaintext is a buffer')

    const ciphertext = box2.encrypt(plaintext, opts)

    box2.setOwnDMKey(
      Buffer.from(
        '30720d8f9cbf37f6d7062826f6decac93e308060a8aaaa77e6a4747f40ee1a76',
        'hex'
      )
    )

    const decrypted = box2.decrypt(ciphertext, { ...opts, author: keys.id })
    t.equal(decrypted, null, 'decrypted is "null"')

    t.end()
  })
})

test('cannot encrypt to zero valid recipients', (t) => {
  const box2 = Box2()
  const keys = ssbKeys.generate(null, 'alice', 'buttwoo-v1')

  box2.setup({ keys }, () => {
    const opts = {
      keys,
      content: { type: 'post', text: 'super secret' },
      previous: null,
      timestamp: 12345678900,
      tag: buttwoo.tags.SSB_FEED,
      hmacKey: null,
      recps: ['nonsense'],
    }

    const plaintext = buttwoo.toPlaintextBuffer(opts)
    t.true(Buffer.isBuffer(plaintext), 'plaintext is a buffer')

    t.throws(() => {
      box2.encrypt(plaintext, opts)
    }, /no box2 keys found for recipients/)

    t.end()
  })
})

test('cannot encrypt to more than 16 recipients', (t) => {
  const box2 = Box2()
  const keys = ssbKeys.generate(null, 'alice', 'buttwoo-v1')

  box2.setup({ keys }, () => {
    const opts = {
      keys,
      content: { type: 'post', text: 'super secret' },
      previous: null,
      timestamp: 12345678900,
      tag: buttwoo.tags.SSB_FEED,
      hmacKey: null,
      recps: [
        keys.id,
        ssbKeys.generate(null, '2').id,
        ssbKeys.generate(null, '3').id,
        ssbKeys.generate(null, '4').id,
        ssbKeys.generate(null, '5').id,
        ssbKeys.generate(null, '6').id,
        ssbKeys.generate(null, '7').id,
        ssbKeys.generate(null, '8').id,
        ssbKeys.generate(null, '9').id,
        ssbKeys.generate(null, '10').id,
        ssbKeys.generate(null, '11').id,
        ssbKeys.generate(null, '12').id,
        ssbKeys.generate(null, '13').id,
        ssbKeys.generate(null, '14').id,
        ssbKeys.generate(null, '15').id,
        ssbKeys.generate(null, '16').id,
        ssbKeys.generate(null, 'seventeen').id,
      ],
    }

    const plaintext = buttwoo.toPlaintextBuffer(opts)
    t.true(Buffer.isBuffer(plaintext), 'plaintext is a buffer')

    t.throws(() => {
      box2.encrypt(plaintext, opts)
    }, /private-group spec allows maximum 16 slots, but you've tried to use 17/)

    t.end()
  })
})

test('cannot encrypt to more than 1 group recipients', (t) => {
  const box2 = Box2()
  const keys = ssbKeys.generate(null, 'alice', 'buttwoo-v1')

  box2.setup({ keys }, () => {
    const groupId1 = '%Aihvp+fMdt5CihjbOY6eZc0qCe0eKsrN2wfgXV2E3PM=.cloaked'
    const groupId2 = '%Bihvp+fMdt5CihjbOY6eZc0qCe0eKsrN2wfgXV2E3PM=.cloaked'
    box2.addGroupInfo(groupId1, {
      key: Buffer.from(
        '30720d8f9cbf37f6d7062826f6decac93e308060a8aaaa77e6a4747f40ee1a76',
        'hex'
      ),
    })
    box2.addGroupInfo(groupId2, {
      key: Buffer.from(
        'ff720d8f9cbf37f6d7062826f6decac93e308060a8aaaa77e6a4747f40ee1a76',
        'hex'
      ),
    })

    const opts = {
      keys,
      content: { type: 'post', text: 'super secret' },
      previous: null,
      timestamp: 12345678900,
      tag: buttwoo.tags.SSB_FEED,
      hmacKey: null,
      recps: [groupId1, groupId2],
    }

    const plaintext = buttwoo.toPlaintextBuffer(opts)
    t.true(Buffer.isBuffer(plaintext), 'plaintext is a buffer')

    t.throws(() => {
      box2.encrypt(plaintext, opts)
    }, /private-group spec only supports one group recipient, but you've tried to use 2/)

    t.end()
  })
})

test('encrypt accepts keys as recps', (t) => {
  const box2 = Box2()
  const keys = ssbKeys.generate(null, 'alice', 'buttwoo-v1')

  box2.setup({ keys }, () => {
    const opts = {
      keys,
      content: { type: 'post', text: 'super secret' },
      previous: null,
      timestamp: 12345678900,
      tag: buttwoo.tags.SSB_FEED,
      hmacKey: null,
      recps: [
        {
          key: Buffer.from(
            '30720d8f9cbf37f6d7062826f6decac93e308060a8aaaa77e6a4747f40ee1a76',
            'hex'
          ),
          scheme: keySchemes.private_group,
        },
      ],
    }

    const plaintext = buttwoo.toPlaintextBuffer(opts)

    box2.encrypt(plaintext, opts)

    t.end()
  })
})
