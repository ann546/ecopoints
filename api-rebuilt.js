// Rebuild of the api-extended.js routes that were lost. Appended after an
// accidental bulk delete; the schemas and response shapes are matched to
// what the front end and legacy-bridge.js read.
module.exports = function attachRebuiltRoutes(app, db) {
  /* ---------- shared helpers ---------- */

  function notify(recipientRole, recipientId, category, title, message, linkPage, callback) {
    const done = typeof callback === 'function' ? callback : function () {};

    db.query(
      `INSERT INTO notifications
          (recipient_role, recipient_id, category, title, message, link_page)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [recipientRole, recipientId, category, title, message, linkPage || null],
      function (err) {
        if (err) console.log('Notification insert error:', err.message);
        done(err);
      }
    );
  }

  function route(handler) {
    return function (req, res) {
      try {
        handler(req, res);
      } catch (err) {
        console.log('Unhandled route error:', err.message);
        res.status(500).json({ success: false, error: 'Server error.' });
      }
    };
  }

  function toInt(value) {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function notifySubstitute(substituteEmail, groupNumber, slot, absentEmail, absentRole) {
    db.query(
      'SELECT collector_id, first_name FROM collectors WHERE email = ? LIMIT 1',
      [substituteEmail],
      function (lookupErr, rows) {
        if (lookupErr || !rows || !rows.length) return;

        const sub = rows[0];
        const firstName = String(sub.first_name || '').trim();
        const who = absentEmail ? String(absentEmail).split('@')[0] : 'a team member';
        const roleText = absentRole ? ' (' + absentRole + ')' : '';

        notify(
          'collector', sub.collector_id, 'substitute',
          'Substitute duty - Group ' + groupNumber,
          ('Hi ' + (firstName || 'there') + ', you have been assigned to cover for ' +
            who + roleText + ' in Group ' + groupNumber + ' today. ' +
            'Please report to the group before collection starts.').slice(0, 255),
          'Collector Dashboard.html'
        );
      }
    );
  }

  function notifySubstituteStandDown(substituteEmail, groupNumber) {
    db.query(
      'SELECT collector_id, first_name FROM collectors WHERE email = ? LIMIT 1',
      [substituteEmail],
      function (lookupErr, rows) {
        if (lookupErr || !rows || !rows.length) return;

        const sub = rows[0];
        const firstName = String(sub.first_name || '').trim();

        notify(
          'collector', sub.collector_id, 'substitute',
          'Group ' + groupNumber + ' duty cancelled',
          'Hi ' + (firstName || 'there') + ', the absence in Group ' + groupNumber +
            ' has been cleared. You are no longer needed to cover today.',
          'Collector Dashboard.html'
        );
      }
    );
  }

  function notifyAbsentee(absentEmail, groupNumber, substituteEmail) {
    db.query(
      'SELECT collector_id, first_name FROM collectors WHERE email = ? LIMIT 1',
      [absentEmail],
      function (lookupErr, rows) {
        if (lookupErr || !rows || !rows.length) return;

        const sub = rows[0];
        const firstName = String(sub.first_name || '').trim();
        const cover = substituteEmail
          ? String(substituteEmail).split('@')[0] + ' is covering for you.'
          : 'No substitute has been assigned yet.';

        notify(
          'collector', sub.collector_id, 'absence',
          'You are marked absent today',
          'Hi ' + (firstName || 'there') + ', an admin marked you absent for Group ' +
            groupNumber + ' today. ' + cover,
          'Collector Dashboard.html'
        );
      }
    );
  }

  /* ---------- waste collections ---------- */

  const COLLECTION_SELECT = `
      SELECT c.collection_id, c.resident_id, c.collector_id, c.scan_id,
             c.waste_type, c.weight_kg, c.points_earned, c.verification_status,
             c.collector_note, c.collected_at, c.verified_at,
             r.email AS resident_email, r.account_id, r.first_name AS resident_first,
             r.last_name AS resident_last, r.house_number, r.street,
             col.collector_code, col.first_name AS collector_first,
             col.last_name AS collector_last
        FROM waste_collections c
        JOIN residents r  ON r.resident_id = c.resident_id
        JOIN collectors col ON col.collector_id = c.collector_id
  `;

  function mapCollection(row) {
    return {
      collectionId: row.collection_id,
      collection_id: row.collection_id,
      resident_id: row.resident_id,
      residentId: row.resident_id,
      accountId: row.account_id,
      account_id: row.account_id,
      residentName: [row.resident_first, row.resident_last].filter(Boolean).join(' ') || row.resident_email,
      email: row.resident_email,
      street: row.street,
      houseNumber: row.house_number,
      collector_id: row.collector_id,
      collectorId: row.collector_id,
      collectorCode: row.collector_code,
      collectorName: [row.collector_first, row.collector_last].filter(Boolean).join(' '),
      scan_id: row.scan_id,
      wasteType: row.waste_type,
      weightKg: Number(row.weight_kg || 0),
      verifiedWeightKg: Number(row.weight_kg || 0),
      pointsEarned: Number(row.points_earned || 0),
      pointsAwarded: Number(row.points_earned || 0),
      verificationStatus: row.verification_status || 'pending',
      collectorNote: row.collector_note,
      collectedAt: row.collected_at,
      verifiedAt: row.verified_at,
    };
  }

  app.get('/api/waste-collections', route(function (req, res) {
    const collectorId = toInt(req.query.collector_id);
    const residentId = toInt(req.query.resident_id);
    const status = String(req.query.status || '').trim().toLowerCase();
    const limit = Math.min(Number(req.query.limit) || 200, 500);

    let where = '1 = 1';
    const params = [];

    if (collectorId) { where += ' AND c.collector_id = ?'; params.push(collectorId); }
    if (residentId) { where += ' AND c.resident_id = ?'; params.push(residentId); }
    if (status && status !== 'all') { where += ' AND c.verification_status = ?'; params.push(status); }

    params.push(limit);

    db.query(
      COLLECTION_SELECT + ' WHERE ' + where + ' ORDER BY c.collected_at DESC LIMIT ?',
      params,
      function (err, rows) {
        if (err) {
          console.log('Waste collections error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not load collections.' });
        }
        res.json({ success: true, collections: (rows || []).map(mapCollection) });
      }
    );
  }));

  app.get('/api/collection-history', route(function (req, res) {
    const residentId = toInt(req.query.resident_id);
    const limit = Math.min(Number(req.query.limit) || 200, 500);

    let where = '1 = 1';
    const params = [];

    if (residentId) { where += ' AND c.resident_id = ?'; params.push(residentId); }
    params.push(limit);

    db.query(
      COLLECTION_SELECT + ' WHERE ' + where + ' ORDER BY c.collected_at DESC LIMIT ?',
      params,
      function (err, rows) {
        if (err) {
          console.log('Collection history error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not load the collection history.' });
        }
        res.json({ success: true, history: (rows || []).map(mapCollection) });
      }
    );
  }));

  app.post('/api/waste-collections', route(function (req, res) {
    const residentId = toInt(req.body.resident_id);
    const collectorId = toInt(req.body.collector_id);
    const scanId = toInt(req.body.scan_id);
    const wasteType = String(req.body.waste_type || '').trim();
    const weight = Number(req.body.weight_kg);
    const points = Number(req.body.points_earned);
    const note = String(req.body.collector_note || '').trim() || null;

    if (!residentId || !collectorId) {
      return res.status(400).json({ success: false, error: 'Resident and collector are required.' });
    }
    if (!wasteType) {
      return res.status(400).json({ success: false, error: 'Waste type is required.' });
    }
    if (!Number.isFinite(weight) || weight <= 0) {
      return res.status(400).json({ success: false, error: 'Weight must be greater than 0.' });
    }
    if (!Number.isFinite(points) || points <= 0) {
      return res.status(400).json({ success: false, error: 'Points must be greater than 0.' });
    }

    const conn = require('mysql2').createConnection({
      host: 'localhost',
      user: 'ecopoints_app',
      password: process.env.DB_PASSWORD || '',
      database: 'ecopoints_db'
    });

    conn.beginTransaction(function (err) {
      if (err) {
        console.error('waste-collections: beginTransaction failed:', err.message);
        conn.end();
        return res.status(500).json({ success: false, error: 'Could not record the collection.' });
      }

      conn.query(
        `INSERT INTO waste_collections
            (resident_id, collector_id, scan_id, waste_type, weight_kg, points_earned, collector_note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [residentId, collectorId, scanId, wasteType, weight, points, note],
        function (err2, result) {
          if (err2) {
            console.error('waste-collections: insert failed:', err2.message,
              '(resident ' + residentId + ', collector ' + collectorId + ')');

            if (err2.code === 'ER_NO_REFERENCED_ROW_2') {
              return conn.rollback(function () {
                conn.end();
                res.status(409).json({
                  success: false,
                  error: 'Your collector session is out of date. Please log out and log in again.'
                });
              });
            }

            return conn.rollback(function () {
              conn.end();
              res.status(500).json({ success: false, error: 'Could not record the collection.' });
            });
          }

          const collectionId = result.insertId;

          conn.query(
            `UPDATE residents
                SET ecopoints_balance = ecopoints_balance + ?
              WHERE resident_id = ?
                AND account_status = 'active'`,
            [points, residentId],
            function (err3, upd) {
              if (err3) {
                return conn.rollback(function () {
                  conn.end();
                  res.status(500).json({ success: false, error: 'Could not credit the points.' });
                });
              }

              if (!upd.affectedRows) {
                return conn.rollback(function () {
                  conn.end();
                  res.status(403).json({ success: false, error: 'This account is not active.' });
                });
              }

              conn.query(
                `INSERT INTO resident_points_history
                    (resident_id, entry_type, description, points)
                 VALUES (?, 'scan', ?, ?)`,
                [residentId, wasteType + ' (' + weight + ' kg)', points],
                function (err4) {
                  if (err4) {
                    return conn.rollback(function () {
                      conn.end();
                      res.status(500).json({ success: false, error: 'Could not record the points.' });
                    });
                  }

                  conn.query(
                    'SELECT ecopoints_balance FROM residents WHERE resident_id = ?',
                    [residentId],
                    function (err5, rows) {
                      conn.commit(function () {
                        conn.end();

                        if (err5 || !rows || !rows.length) {
                          return res.json({ success: true, collection_id: collectionId, newBalance: null });
                        }

                        const newBalance = Number(rows[0].ecopoints_balance);

                        notify(
                          'resident', residentId, 'points',
                          '+' + points + ' EcoPoints earned!',
                          'Thank you for recycling ' + weight + ' kg of ' + wasteType + '.',
                          'My EcoPoints.html'
                        );

                        res.json({ success: true, collection_id: collectionId, newBalance: newBalance });
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  }));

  app.patch('/api/waste-collections/:id/verify', route(function (req, res) {
    const collectionId = toInt(req.params.id);
    const status = String(req.body.verification_status || '').trim();
    const adminId = toInt(req.body.admin_id);

    if (!collectionId) {
      return res.status(400).json({ success: false, error: 'Invalid collection ID.' });
    }
    if (['verified', 'rejected', 'pending'].indexOf(status) === -1) {
      return res.status(400).json({ success: false, error: 'Invalid verification status.' });
    }

    db.query(
      `UPDATE waste_collections
          SET verification_status = ?, verified_at = NOW()
        WHERE collection_id = ?`,
      [status, collectionId],
      function (err) {
        if (err) {
          console.log('Verify collection error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not verify the collection.' });
        }

        db.query(
          `SELECT resident_id, waste_type, weight_kg
             FROM waste_collections WHERE collection_id = ?`,
          [collectionId],
          function (err2, rows) {
            if (err2 || !rows || !rows.length) {
              return res.json({ success: true });
            }

            const row = rows[0];

            if (adminId) {
              db.query(
                `INSERT INTO admin_activity_log
                    (admin_id, action, target_type, target_id, details)
                 VALUES (?, 'verify_waste', 'collection', ?, ?)`,
                [adminId, String(collectionId), row.waste_type + ' ' + row.weight_kg + 'kg'],
                function () {}
              );
            }

            if (status === 'verified') {
              notify(
                'resident', row.resident_id, 'points',
                'Drop-off verified',
                'Your ' + row.waste_type + ' drop-off has been verified by an admin.',
                'Collection History.html'
              );
            }

            res.json({ success: true });
          }
        );
      }
    );
  }));

  /* ---------- collector QR scans ---------- */

  app.post('/api/collector-qr-scans', route(function (req, res) {
    const collectorId = toInt(req.body.collector_id);
    const residentId = toInt(req.body.resident_id);
    const qrValue = String(req.body.scanned_qr_value || '').trim() || null;

    if (!collectorId || !residentId) {
      return res.status(400).json({ success: false, error: 'Collector and resident are required.' });
    }

    db.query(
      `INSERT INTO collector_qr_scans
          (collector_id, resident_id, scanned_qr_value)
       VALUES (?, ?, ?)`,
      [collectorId, residentId, qrValue],
      function (err, result) {
        if (err) {
          console.log('QR scan error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not save the scan.' });
        }
        res.json({ success: true, scan_id: result.insertId });
      }
    );
  }));

  app.get('/api/collector-qr-scans', route(function (req, res) {
    const collectorId = toInt(req.query.collector_id);
    const residentId = toInt(req.query.resident_id);
    const limit = Math.min(Number(req.query.limit) || 100, 300);

    let where = '1 = 1';
    const params = [];

    if (collectorId) { where += ' AND s.collector_id = ?'; params.push(collectorId); }
    if (residentId) { where += ' AND s.resident_id = ?'; params.push(residentId); }
    params.push(limit);

    db.query(
      `SELECT s.scan_id, s.collector_id, s.resident_id, s.scanned_qr_value, s.scanned_at,
              r.account_id, r.first_name, r.last_name, r.email
         FROM collector_qr_scans s
         JOIN residents r ON r.resident_id = s.resident_id
        WHERE ` + where + `
        ORDER BY s.scanned_at DESC LIMIT ?`,
      params,
      function (err, rows) {
        if (err) {
          console.log('QR scans error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not load the scans.' });
        }

        res.json({
          success: true,
          scans: (rows || []).map(function (r) {
            return {
              scan_id: r.scan_id,
              collector_id: r.collector_id,
              resident_id: r.resident_id,
              accountId: r.account_id,
              account_id: r.account_id,
              residentName: [r.first_name, r.last_name].filter(Boolean).join(' '),
              name: [r.first_name, r.last_name].filter(Boolean).join(' '),
              email: r.email,
              scanned_qr_value: r.scanned_qr_value,
              scanned_at: r.scanned_at
            };
          })
        });
      }
    );
  }));

  /* ---------- groups and streets ---------- */

  app.get('/api/collector-groups', route(function (req, res) {
    db.query(
      'SELECT group_number, group_name, created_at FROM collector_groups ORDER BY group_number ASC',
      function (err, rows) {
        if (err) {
          console.log('Collector groups error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not load the groups.' });
        }
        res.json({ success: true, groups: rows || [] });
      }
    );
  }));

  app.get('/api/collector-groups/:number/streets', route(function (req, res) {
    const number = toInt(req.params.number);
    if (!number) {
      return res.status(400).json({ success: false, error: 'Invalid group number.' });
    }

    db.query(
      'SELECT street_name FROM collector_group_streets WHERE group_number = ? ORDER BY street_name ASC',
      [number],
      function (err, rows) {
        if (err) {
          console.log('Group streets error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not load the streets.' });
        }
        res.json({ success: true, streets: (rows || []).map(function (r) { return r.street_name; }) });
      }
    );
  }));

  app.get('/api/streets', route(function (req, res) {
    db.query(
      `SELECT DISTINCT street_name AS street, group_number
         FROM collector_group_streets
        ORDER BY street ASC`,
      function (err, rows) {
        if (err) {
          console.log('Streets error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not load the streets.' });
        }
        res.json({ success: true, streets: rows || [] });
      }
    );
  }));

  /* ---------- collection schedules ---------- */

  function mapSchedule(row) {
    return {
      id: row.admin_schedule_id,
      schedule_id: row.admin_schedule_id,
      group_number: row.group_number,
      street: row.street,
      collection_date: row.collection_date,
      collection_day: row.collection_day,
      start_time: row.start_time,
      end_time: row.end_time,
      schedule_status: row.schedule_status,
      created_by: row.created_by,
      updated_at: row.updated_at
    };
  }

  app.get('/api/collection-schedules', route(function (req, res) {
    const groupNumber = toInt(req.query.group_number);
    const month = String(req.query.month || '').trim();

    let where = '1 = 1';
    const params = [];

    if (groupNumber) { where += ' AND group_number = ?'; params.push(groupNumber); }
    if (/^\d{4}-\d{2}$/.test(month)) {
      where += ' AND DATE_FORMAT(collection_date, \'%Y-%m\') = ?';
      params.push(month);
    }

    db.query(
      'SELECT * FROM admin_collection_schedules WHERE ' + where +
      ' ORDER BY collection_date ASC, group_number ASC LIMIT 1000',
      params,
      function (err, rows) {
        if (err) {
          console.log('Schedules error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not load the schedule.' });
        }
        res.json({ success: true, schedules: (rows || []).map(mapSchedule) });
      }
    );
  }));

  app.post('/api/collection-schedules', route(function (req, res) {
    const groupNumber = toInt(req.body.group_number);
    const street = String(req.body.street || '').trim();
    const date = String(req.body.collection_date || '').trim();
    const day = String(req.body.collection_day || '').trim();
    const start = String(req.body.start_time || '').trim() || null;
    const end = String(req.body.end_time || '').trim() || null;
    const createdBy = toInt(req.body.created_by);

    if (!groupNumber || !street || !date || !day) {
      return res.status(400).json({ success: false, error: 'Group, street, date and day are required.' });
    }

    db.query(
      `INSERT INTO admin_collection_schedules
          (group_number, street, collection_date, collection_day, start_time, end_time, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [groupNumber, street, date, day, start, end, createdBy],
      function (err, result) {
        if (err) {
          console.log('Create schedule error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not save the schedule.' });
        }
        res.json({ success: true, schedule_id: result.insertId });
      }
    );
  }));

  app.patch('/api/collection-schedules/:id', route(function (req, res) {
    const id = toInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid schedule ID.' });
    }

    const fields = [];
    const params = [];

    ['street', 'collection_date', 'collection_day', 'start_time', 'end_time', 'schedule_status']
      .forEach(function (key) {
        if (req.body[key] !== undefined) {
          fields.push(key + ' = ?');
          params.push(req.body[key] === '' ? null : req.body[key]);
        }
      });

    if (!fields.length) {
      return res.status(400).json({ success: false, error: 'Nothing to update.' });
    }

    params.push(id);

    db.query(
      'UPDATE admin_collection_schedules SET ' + fields.join(', ') +
      ', updated_at = NOW() WHERE admin_schedule_id = ?',
      params,
      function (err) {
        if (err) {
          console.log('Update schedule error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not update the schedule.' });
        }
        res.json({ success: true });
      }
    );
  }));

  app.post('/api/collection-schedules/:id/publish', route(function (req, res) {
    const id = toInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid schedule ID.' });
    }

    db.query(
      `INSERT INTO resident_collection_schedule
          (resident_id, collection_date, collection_day, start_time, end_time, street)
       SELECT r.resident_id, s.collection_date, s.collection_day, s.start_time, s.end_time, s.street
         FROM admin_collection_schedules s
         JOIN residents r ON r.street = s.street
        WHERE s.admin_schedule_id = ?`,
      [id],
      function (err) {
        if (err) {
          console.log('Publish schedule error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not publish the schedule.' });
        }
        res.json({ success: true });
      }
    );
  }));

  /* ---------- street assignments ---------- */

  app.post('/api/street-assignments', route(function (req, res) {
    const street = String(req.body.street || '').trim();
    const groupNumber = toInt(req.body.group_number);
    const day = String(req.body.collection_day || '').trim() || null;
    const classification = String(req.body.street_classification || '').trim() || null;
    const order = Number(req.body.route_order) || 0;
    const assignedBy = toInt(req.body.assigned_by);

    if (!street || !groupNumber) {
      return res.status(400).json({ success: false, error: 'Street and group are required.' });
    }

    db.query(
      'SELECT group_number FROM street_assignments WHERE street = ? LIMIT 1',
      [street],
      function (readErr, existing) {
        const oldGroup = existing && existing.length ? existing[0].group_number : null;

        db.query(
          `INSERT INTO street_assignments
              (street, street_classification, group_number, collection_day, route_order, assigned_by)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
              street_classification = VALUES(street_classification),
              group_number           = VALUES(group_number),
              collection_day         = VALUES(collection_day),
              route_order            = VALUES(route_order),
              assigned_by            = VALUES(assigned_by),
              updated_at             = NOW()`,
          [street, classification, groupNumber, day, order, assignedBy],
          function (err) {
            if (err) {
              console.log('Street assignment error:', err.message);
              return res.status(500).json({ success: false, error: 'Could not save the assignment.' });
            }

            // Keep the legacy per-group street list in step.
            db.query(
              'DELETE FROM collector_group_streets WHERE street_name = ?',
              [street],
              function () {
                db.query(
                  'INSERT INTO collector_group_streets (group_number, street_name) VALUES (?, ?)',
                  [groupNumber, street],
                  function () {
                    if (oldGroup !== null && Number(oldGroup) !== groupNumber) {
                      db.query(
                        `INSERT INTO street_assignment_history
                            (street, old_group_number, new_group_number, changed_by)
                         VALUES (?, ?, ?, ?)`,
                        [street, oldGroup, groupNumber, assignedBy],
                        function () {}
                      );
                    }
                    res.json({ success: true });
                  }
                );
              }
            );
          }
        );
      }
    );
  }));

  /* ---------- admin activity log ---------- */

  app.post('/api/admin/activity', route(function (req, res) {
    const adminId = toInt(req.body.admin_id);
    const action = String(req.body.action || '').trim();
    const targetType = String(req.body.target_type || '').trim();
    const targetId = String(req.body.target_id || '').trim() || null;
    const details = String(req.body.details || '').trim() || null;

    if (!action || !targetType) {
      return res.status(400).json({ success: false, error: 'Action and target type are required.' });
    }

    db.query(
      `INSERT INTO admin_activity_log
          (admin_id, action, target_type, target_id, details)
       VALUES (?, ?, ?, ?, ?)`,
      [adminId, action, targetType, targetId, details],
      function (err) {
        if (err) {
          console.log('Activity log error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not record the activity.' });
        }
        res.json({ success: true });
      }
    );
  }));

  app.get('/api/admin/activity', route(function (req, res) {
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    db.query(
      `SELECT l.log_id, l.admin_id, l.action, l.target_type, l.target_id,
              l.details, l.created_at, a.email AS admin_email
         FROM admin_activity_log l
         LEFT JOIN admins a ON a.admin_id = l.admin_id
        ORDER BY l.created_at DESC LIMIT ?`,
      [limit],
      function (err, rows) {
        if (err) {
          console.log('Activity log read error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not load the activity log.' });
        }
        res.json({ success: true, activity: rows || [] });
      }
    );
  }));

  /* ---------- collector profile update ---------- */

  app.put('/api/collectors/:id', route(function (req, res) {
    const id = toInt(req.params.id);
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid collector ID.' });
    }

    const fields = [];
    const params = [];

    ['first_name', 'last_name', 'phone', 'position', 'group_number', 'account_status']
      .forEach(function (key) {
        if (req.body[key] !== undefined) {
          fields.push(key + ' = ?');
          params.push(req.body[key] === '' ? null : req.body[key]);
        }
      });

    if (!fields.length) {
      return res.status(400).json({ success: false, error: 'Nothing to update.' });
    }

    params.push(id);

    db.query(
      'UPDATE collectors SET ' + fields.join(', ') + ' WHERE collector_id = ?',
      params,
      function (err) {
        if (err) {
          console.log('Update collector error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not update the collector.' });
        }

        db.query(
          `SELECT collector_id, collector_code, email, first_name, last_name, phone,
                  position, group_number, account_status
             FROM collectors WHERE collector_id = ?`,
          [id],
          function (err2, rows) {
            if (err2 || !rows || !rows.length) {
              return res.status(404).json({ success: false, error: 'Collector not found.' });
            }
            res.json({ success: true, collector: rows[0] });
          }
        );
      }
    );
  }));

  /* ---------- collector absences ---------- */

  app.get('/api/collector-absences', route(function (req, res) {
    const date = String(req.query.date || req.query.absence_date || '').trim();

    const sql = date
      ? `SELECT group_number, slot, substitute_collector_id, substitute_email
           FROM collector_absences WHERE absence_date = ?`
      : `SELECT group_number, slot, substitute_collector_id, substitute_email
           FROM collector_absences WHERE absence_date = CURDATE()`;

    db.query(sql, date ? [date] : [], function (err, rows) {
      if (err) {
        console.log('Absences read error:', err.message);
        return res.status(500).json({ success: false, error: 'Could not load the absences.' });
      }

      const absences = {};
      (rows || []).forEach(function (r) {
        const g = String(r.group_number);
        if (!absences[g]) absences[g] = {};
        absences[g][String(r.slot)] = r.substitute_email || '';
      });

      res.json({ success: true, absences: absences, date: date || null });
    });
  }));

  app.post('/api/collector-absences', route(function (req, res) {
    const date = String(req.body.absence_date || '').trim();
    const groupNumber = toInt(req.body.group_number);
    const slot = Number(req.body.slot || 0);
    let substituteId = toInt(req.body.substitute_collector_id);
    const substituteEmail = String(req.body.substitute_email || '').trim() || null;
    const absentEmail = String(req.body.absent_email || '').trim() || null;
    const absentRole = String(req.body.absent_role || '').trim() || null;
    const createdBy = toInt(req.body.created_by);

    if (!date || !groupNumber) {
      return res.status(400).json({ success: false, error: 'Date and group are required.' });
    }
    if (!Number.isInteger(slot) || slot < 0) {
      return res.status(400).json({ success: false, error: 'Invalid slot.' });
    }

    // The dashboard sends the id, but a request that only carries the
    // email should still record a resolvable substitute. Without this the
    // row saved substitute_email with a null substitute_collector_id, which
    // is what the "covering another group" count reads.
    const resolveId = function (email, done) {
      if (!email) return done(null);

      db.query(
        'SELECT collector_id FROM collectors WHERE email = ? LIMIT 1',
        [email],
        function (lookupErr, rows) {
          if (lookupErr || !rows || !rows.length) return done(null);
          done(rows[0].collector_id);
        }
      );
    };

    const saveAbsence = function (absentId) {
      db.query(
        `INSERT INTO collector_absences
            (absence_date, group_number, slot, absent_collector_id, absent_email,
             substitute_collector_id, substitute_email, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            absent_collector_id     = VALUES(absent_collector_id),
            absent_email           = VALUES(absent_email),
            substitute_collector_id = VALUES(substitute_collector_id),
            substitute_email       = VALUES(substitute_email),
            created_by             = VALUES(created_by)`,
        [date, groupNumber, slot, absentId, absentEmail, substituteId, substituteEmail, createdBy],
        function (err) {
          if (err) {
            console.log('Save absence error:', err.message);
            return res.status(500).json({ success: false, error: 'Could not save the absence.' });
          }

          res.json({ success: true });

          if (substituteEmail) {
            notifySubstitute(substituteEmail, groupNumber, slot, absentEmail, absentRole);
          }
          if (absentEmail) {
            notifyAbsentee(absentEmail, groupNumber, substituteEmail);
          }
        }
      );
    };

    // Both ids are optional on the wire, so fill in whichever one the
    // caller left out before writing the row. The "covering another
    // group" count reads substitute_email, but the attendance history
    // reads substitute_collector_id, so both have to be filled.
    const withIds = function (done) {
      resolveId(substituteEmail, function (fromEmail) {
        if (!substituteId) substituteId = fromEmail;

        if (!absentEmail) return done(null);

        db.query(
          'SELECT collector_id FROM collectors WHERE email = ? LIMIT 1',
          [absentEmail],
          function (lookupErr, rows) {
            if (lookupErr || !rows || !rows.length) return done(null);
            done(rows[0].collector_id);
          }
        );
      });
    };

    withIds(saveAbsence);
  }));

  app.get('/api/collector-absences/history', route(function (req, res) {
    const email = String(req.query.email || '').trim();
    const collectorId = toInt(req.query.collector_id);
    const groupNumber = toInt(req.query.group_number);

    if (!email && !collectorId) {
      return res.status(400).json({ success: false, error: 'Provide an email or a collector id.' });
    }

    let where = 'a.absence_date <= CURDATE()';
    const params = [];

    if (collectorId) {
      where += ' AND a.absent_collector_id = ?';
      params.push(collectorId);
    } else {
      where += ' AND a.absent_email = ?';
      params.push(email);
    }

    if (groupNumber) {
      where += ' AND a.group_number = ?';
      params.push(groupNumber);
    }

    db.query(
      `SELECT a.absence_id, a.absence_date, a.group_number, a.slot,
              a.absent_email, a.substitute_email, g.group_name
         FROM collector_absences a
         LEFT JOIN collector_groups g ON g.group_number = a.group_number
        WHERE ${where}
        ORDER BY a.absence_date DESC, a.group_number ASC
        LIMIT 60`,
      params,
      function (err, rows) {
        if (err) {
          console.log('Absence history error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not load the absence history.' });
        }
        res.json({ success: true, absences: rows || [] });
      }
    );
  }));

  app.delete('/api/collector-absences', route(function (req, res) {
    const date = String(req.query.absence_date || req.query.date || '').trim();
    const groupNumber = toInt(req.query.group_number);
    const slot = Number(req.query.slot);

    if (!date || !groupNumber || !Number.isInteger(slot)) {
      return res.status(400).json({ success: false, error: 'Date, group and slot are required.' });
    }

    db.query(
      'SELECT substitute_email FROM collector_absences WHERE absence_date = ? AND group_number = ? AND slot = ?',
      [date, groupNumber, slot],
      function (readErr, rows) {
        if (readErr) {
          console.log('Read absence error:', readErr.message);
          return res.status(500).json({ success: false, error: 'Could not clear the absence.' });
        }

        db.query(
          'DELETE FROM collector_absences WHERE absence_date = ? AND group_number = ? AND slot = ?',
          [date, groupNumber, slot],
          function (err) {
            if (err) {
              console.log('Clear absence error:', err.message);
              return res.status(500).json({ success: false, error: 'Could not clear the absence.' });
            }

            res.json({ success: true });

            const substituteEmail = rows && rows.length ? rows[0].substitute_email : null;
            if (substituteEmail) notifySubstituteStandDown(substituteEmail, groupNumber);
          }
        );
      }
    );
  }));

  /* ---------- password reset ---------- */

  const crypto = require('crypto');

  function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
  }

  app.post('/api/password-reset/request', route(function (req, res) {
    const email = String(req.body.email || '').trim().toLowerCase();
    const kind = String(req.body.account_kind || 'resident').trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    const table = kind === 'collector' ? 'collectors' : kind === 'admin' ? 'admins' : 'residents';

    db.query(
      'SELECT * FROM ' + table + ' WHERE email = ? LIMIT 1',
      [email],
      function (err, rows) {
        if (err) {
          console.log('Password reset lookup error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not start the reset.' });
        }

        // Always answer the same way so the form cannot be used to find
        // which addresses are registered.
        if (!rows || !rows.length) {
          return res.json({ success: true, message: 'If that account exists, a reset link has been sent.' });
        }

        const account = rows[0];
        const idColumn = kind === 'collector' ? 'collector_id' : kind === 'admin' ? 'admin_id' : 'resident_id';
        const token = crypto.randomBytes(24).toString('hex');
        const expires = new Date(Date.now() + 60 * 60 * 1000);

        db.query(
          `INSERT INTO password_reset_tokens
              (email, account_kind, account_id, token_hash, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
          [email, kind, account[idColumn], hashToken(token), expires],
          function (err2) {
            if (err2) {
              console.log('Password reset insert error:', err2.message);
              return res.status(500).json({ success: false, error: 'Could not start the reset.' });
            }

            // There is no mail server in this project, so the link is
            // returned for the demo instead of being emailed.
            res.json({
              success: true,
              message: 'If that account exists, a reset link has been sent.',
              reset_token: token,
              expires_at: expires
            });
          }
        );
      }
    );
  }));

  app.post('/api/password-reset/confirm', route(function (req, res) {
    const token = String(req.body.token || '').trim();
    const password = String(req.body.password || '');

    if (!token || !password) {
      return res.status(400).json({ success: false, error: 'Token and password are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    }

    db.query(
      `SELECT token_id, email, account_kind, account_id
         FROM password_reset_tokens
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
        LIMIT 1`,
      [hashToken(token)],
      function (err, rows) {
        if (err) {
          console.log('Password reset confirm error:', err.message);
          return res.status(500).json({ success: false, error: 'Could not reset the password.' });
        }
        if (!rows || !rows.length) {
          return res.status(400).json({ success: false, error: 'That reset link is invalid or has expired.' });
        }

        const row = rows[0];
        const table = row.account_kind === 'collector' ? 'collectors'
          : row.account_kind === 'admin' ? 'admins' : 'residents';
        const idColumn = row.account_kind === 'collector' ? 'collector_id'
          : row.account_kind === 'admin' ? 'admin_id' : 'resident_id';

        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.createHash('sha256')
          .update(salt + ':' + password)
          .digest('hex');

        db.query(
          'UPDATE ' + table + ' SET password_hash = ? WHERE ' + idColumn + ' = ?',
          [salt + ':' + hash, row.account_id],
          function (err2) {
            if (err2) {
              console.log('Password reset update error:', err2.message);
              return res.status(500).json({ success: false, error: 'Could not reset the password.' });
            }

            db.query(
              'UPDATE password_reset_tokens SET used_at = NOW() WHERE token_id = ?',
              [row.token_id],
              function () {
                res.json({ success: true, message: 'Your password has been reset.' });
              }
            );
          }
        );
      }
    );
  }));

  /* ---------- change password ---------- */

  app.post('/api/change-password', route(function (req, res) {
    const role = String(req.body.role || 'resident').trim().toLowerCase();
    const id = toInt(req.body.user_id || req.body.resident_id);
    const current = String(req.body.current_password || '');
    const next = String(req.body.new_password || '');

    if (!id || !current || !next) {
      return res.status(400).json({ success: false, error: 'All fields are required.' });
    }
    if (next.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    }

    const table = role === 'collector' ? 'collectors' : role === 'admin' ? 'admins' : 'residents';
    const idColumn = role === 'collector' ? 'collector_id' : role === 'admin' ? 'admin_id' : 'resident_id';

    db.query(
      'SELECT password_hash FROM ' + table + ' WHERE ' + idColumn + ' = ? LIMIT 1',
      [id],
      function (err, rows) {
        if (err || !rows || !rows.length) {
          return res.status(404).json({ success: false, error: 'Account not found.' });
        }

        const stored = String(rows[0].password_hash || '');
        const parts = stored.split(':');

        if (parts.length !== 2) {
          return res.status(400).json({ success: false, error: 'Stored password is not in the expected format.' });
        }
        const currentHash = crypto.createHash('sha256')
          .update(parts[0] + ':' + current)
          .digest('hex');

        if (currentHash !== parts[1]) {
          return res.status(400).json({ success: false, error: 'Your current password is incorrect.' });
        }

        const salt = crypto.randomBytes(16).toString('hex');
        const nextHash = crypto.createHash('sha256')
          .update(salt + ':' + next)
          .digest('hex');

        db.query(
          'UPDATE ' + table + ' SET password_hash = ? WHERE ' + idColumn + ' = ?',
          [salt + ':' + nextHash, id],
          function (err2) {
            if (err2) {
              console.log('Change password error:', err2.message);
              return res.status(500).json({ success: false, error: 'Could not change the password.' });
            }
            res.json({ success: true, message: 'Your password has been changed.' });
          }
        );
      }
    );
  }));
};
