package online.useoros.twa

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BloodGlucoseRecord
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HydrationRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.records.metadata.Metadata
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.health.connect.client.units.Volume
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.Period
import java.time.ZoneId
import kotlin.reflect.KClass

/**
 * Health Connect (BR-PHONE v5), for the Java side (PhoneBridge,
 * HealthPermissionActivity). The page sends the last 30 days of orOS
 * Water and Workouts ({t:"health"}, phone.js healthOut); they go in as
 * this app's own records, keyed "oros-water-<id>" / "oros-workout-<id>",
 * and own records no longer in orOS are deleted. The answer
 * {t:"health-in"} carries what OTHER apps put there: daily step totals,
 * drinks and workouts (phone.js healthIn). Calls block: io thread only.
 * v6: also "vitals", readings for orOS Health (read only, never
 * written): weight, resting heart rate, sleep, blood pressure, blood
 * glucose and oxygen saturation, each {k, ref, at, v:[…], c?, a?, p?}
 * in Health's units (phone.js vitalRow checks them again).
 */
object HealthBridge {
    private const val MAX_IN = 2000
    private const val MAX_OUT = 5000
    private const val WATER = "oros-water-"
    private const val WORKOUT = "oros-workout-"
    private const val SENT = "health-sent"

    @JvmField
    val PERMISSIONS: Set<String> = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(HydrationRecord::class),
        HealthPermission.getWritePermission(HydrationRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getWritePermission(ExerciseSessionRecord::class),
        // v6: readings for orOS Health, read only
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(BloodPressureRecord::class),
        HealthPermission.getReadPermission(BloodGlucoseRecord::class),
        HealthPermission.getReadPermission(OxygenSaturationRecord::class),
    )

    /** "granted" · "some" · "ask" · "denied" · "update" (install or
     *  update Health Connect) · "unavailable" (Android 8 and older). */
    @JvmStatic
    fun status(c: Context): String {
        return try {
            when (HealthConnectClient.getSdkStatus(c)) {
                HealthConnectClient.SDK_AVAILABLE -> {
                    val granted = runBlocking { HealthConnectClient.getOrCreate(c).permissionController.getGrantedPermissions() }
                    when {
                        granted.containsAll(PERMISSIONS) -> "granted"
                        granted.any { it in PERMISSIONS } -> "some"
                        c.getSharedPreferences(PhoneBridge.PREFS, Context.MODE_PRIVATE).getBoolean("asked-health", false) -> "denied"
                        else -> "ask"
                    }
                }
                HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "update"
                else -> "unavailable"
            }
        } catch (e: Throwable) {
            "unavailable"
        }
    }

    @JvmStatic
    fun available(c: Context): Boolean = try {
        HealthConnectClient.getSdkStatus(c) == HealthConnectClient.SDK_AVAILABLE
    } catch (e: Throwable) {
        false
    }

    /** Health Connect's own permission screen (Android 14+: the system's). */
    @JvmStatic
    fun requestIntent(c: Context): Intent =
        PermissionController.createRequestPermissionResultContract().createIntent(c, PERMISSIONS)

    /** Play Store page of Health Connect (Android 13 and older). */
    @JvmStatic
    fun installIntent(): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding"))
            .setPackage("com.android.vending")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** One round: orOS → Health Connect, then the answer for the page. */
    @JvmStatic
    fun sync(c: Context, m: JSONObject): JSONObject = runBlocking { doSync(c, m) }

    /** The switch went off: this app's records leave Health Connect. */
    @JvmStatic
    fun clear(c: Context) {
        if (!available(c)) return
        runBlocking {
            val client = HealthConnectClient.getOrCreate(c)
            val granted = client.permissionController.getGrantedPermissions()
            val all = TimeRangeFilter.after(Instant.EPOCH)
            if (can(granted, HydrationRecord::class, true)) client.deleteRecords(HydrationRecord::class, all)
            if (can(granted, ExerciseSessionRecord::class, true)) client.deleteRecords(ExerciseSessionRecord::class, all)
        }
        c.getSharedPreferences(SENT, Context.MODE_PRIVATE).edit().clear().apply()
    }

    private fun can(granted: Set<String>, type: KClass<out Record>, write: Boolean): Boolean =
        (if (write) HealthPermission.getWritePermission(type) else HealthPermission.getReadPermission(type)) in granted

    private suspend fun doSync(c: Context, m: JSONObject): JSONObject {
        val client = HealthConnectClient.getOrCreate(c)
        val granted = client.permissionController.getGrantedPermissions()
        val zone = ZoneId.systemDefault()
        val now = Instant.now()
        val since = Instant.ofEpochMilli(m.optLong("since", now.toEpochMilli() - 30L * 86_400_000L))
        val range = TimeRangeFilter.between(since, now.plusSeconds(86_400))
        val me = c.packageName
        val out = JSONObject().put("t", "health-in")

        // What was written, by client id → version. Reset once a day, so
        // records someone deleted in Health Connect come back.
        val sp = c.getSharedPreferences(SENT, Context.MODE_PRIVATE)
        val today = LocalDate.now(zone).toString()
        val sent = if (sp.getString("day", "") == today) JSONObject(sp.getString("ids", "{}") ?: "{}") else JSONObject()
        var wrote = 0
        var removed = 0

        if (can(granted, HydrationRecord::class, true)) {
            val keep = HashSet<String>()
            val recs = ArrayList<Record>()
            val list = m.optJSONArray("water") ?: JSONArray()
            for (i in 0 until minOf(list.length(), MAX_OUT)) {
                val w = list.optJSONObject(i) ?: continue
                val id = w.optString("id")
                val ml = w.optDouble("ml", 0.0)
                if (id.isEmpty() || ml <= 0.0 || ml > 5000.0) continue
                val cid = WATER + id
                val v = w.optLong("v")
                keep += cid
                if (sent.optLong(cid, -1) == v) continue
                val at = Instant.ofEpochMilli(w.optLong("at"))
                val end = at.plusSeconds(60)
                recs += HydrationRecord(
                    startTime = at, startZoneOffset = zone.rules.getOffset(at),
                    endTime = end, endZoneOffset = zone.rules.getOffset(end),
                    volume = Volume.milliliters(ml),
                    metadata = Metadata.manualEntry(clientRecordId = cid, clientRecordVersion = v),
                )
                sent.put(cid, v)
            }
            for (chunk in recs.chunked(500)) client.insertRecords(chunk)
            wrote += recs.size
            removed += prune(client, HydrationRecord::class, range, me, WATER, keep, sent)
        }

        if (can(granted, ExerciseSessionRecord::class, true)) {
            val keep = HashSet<String>()
            val recs = ArrayList<Record>()
            val list = m.optJSONArray("workouts") ?: JSONArray()
            for (i in 0 until minOf(list.length(), MAX_OUT)) {
                val w = list.optJSONObject(i) ?: continue
                val id = w.optString("id")
                val st = w.optLong("st")
                val en = w.optLong("en")
                if (id.isEmpty() || en <= st) continue
                val cid = WORKOUT + id
                val v = w.optLong("v")
                keep += cid
                if (sent.optLong(cid, -1) == v) continue
                val s = Instant.ofEpochMilli(st)
                val e = Instant.ofEpochMilli(en)
                val title = w.optString("ti")
                recs += ExerciseSessionRecord(
                    startTime = s, startZoneOffset = zone.rules.getOffset(s),
                    endTime = e, endZoneOffset = zone.rules.getOffset(e),
                    exerciseType = ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING,
                    title = title.ifEmpty { null },
                    metadata = Metadata.manualEntry(clientRecordId = cid, clientRecordVersion = v),
                )
                sent.put(cid, v)
            }
            for (chunk in recs.chunked(500)) client.insertRecords(chunk)
            wrote += recs.size
            removed += prune(client, ExerciseSessionRecord::class, range, me, WORKOUT, keep, sent)
        }
        sp.edit().putString("day", today).putString("ids", sent.toString()).apply()

        if (can(granted, StepsRecord::class, false)) {
            val start = LocalDate.now(zone).minusDays(29).atStartOfDay()
            val groups = client.aggregateGroupByPeriod(
                AggregateGroupByPeriodRequest(
                    metrics = setOf(StepsRecord.COUNT_TOTAL),
                    timeRangeFilter = TimeRangeFilter.between(start, LocalDateTime.now(zone)),
                    timeRangeSlicer = Period.ofDays(1),
                )
            )
            val arr = JSONArray()
            for (g in groups) {
                val n = g.result[StepsRecord.COUNT_TOTAL] ?: continue
                if (n > 0) arr.put(JSONObject().put("d", g.startTime.toLocalDate().toString()).put("n", n))
            }
            out.put("steps", arr)
        }
        if (can(granted, HydrationRecord::class, false)) {
            val arr = JSONArray()
            for (r in readAll(client, HydrationRecord::class, range, emptySet())) {
                if (r.metadata.dataOrigin.packageName == me) continue
                if (arr.length() >= MAX_IN) break
                arr.put(JSONObject().put("ref", r.metadata.id).put("at", r.startTime.toEpochMilli())
                    .put("ml", r.volume.inMilliliters))
            }
            out.put("water", arr)
        }
        if (can(granted, ExerciseSessionRecord::class, false)) {
            val arr = JSONArray()
            for (r in readAll(client, ExerciseSessionRecord::class, range, emptySet())) {
                if (r.metadata.dataOrigin.packageName == me) continue
                if (arr.length() >= MAX_IN) break
                arr.put(JSONObject().put("ref", r.metadata.id).put("st", r.startTime.toEpochMilli())
                    .put("en", r.endTime.toEpochMilli()).put("ti", r.title ?: "").put("kind", kind(r.exerciseType)))
            }
            out.put("workouts", arr)
        }
        out.put("vitals", vitals(client, granted, range, me))
        out.put("wrote", wrote).put("removed", removed)
        return out
    }

    /** v6: other apps' readings for orOS Health, each kind only when
     *  its read permission is granted, at most MAX_IN per kind. */
    private suspend fun vitals(client: HealthConnectClient, granted: Set<String>, range: TimeRangeFilter, me: String): JSONArray {
        val arr = JSONArray()
        fun row(k: String, r: Record, at: Instant, vararg v: Long): JSONObject {
            val values = JSONArray()
            for (x in v) values.put(x)
            return JSONObject().put("k", k).put("ref", r.metadata.id).put("at", at.toEpochMilli()).put("v", values)
        }
        fun other(r: Record) = r.metadata.dataOrigin.packageName != me
        if (can(granted, WeightRecord::class, false)) {
            readAll(client, WeightRecord::class, range, emptySet()).filter(::other).take(MAX_IN).forEach {
                arr.put(row("wt", it, it.time, Math.round(it.weight.inGrams)))
            }
        }
        if (can(granted, RestingHeartRateRecord::class, false)) {
            readAll(client, RestingHeartRateRecord::class, range, emptySet()).filter(::other).take(MAX_IN).forEach {
                arr.put(row("hr", it, it.time, it.beatsPerMinute))
            }
        }
        if (can(granted, SleepSessionRecord::class, false)) {
            val asleep = setOf(
                SleepSessionRecord.STAGE_TYPE_SLEEPING, SleepSessionRecord.STAGE_TYPE_LIGHT,
                SleepSessionRecord.STAGE_TYPE_DEEP, SleepSessionRecord.STAGE_TYPE_REM,
            )
            readAll(client, SleepSessionRecord::class, range, emptySet()).filter(::other).take(MAX_IN).forEach { s ->
                // Minutes asleep: the sleeping stages when the app gave
                // stages, else the whole session.
                val ms = if (s.stages.isEmpty()) s.endTime.toEpochMilli() - s.startTime.toEpochMilli()
                         else s.stages.filter { it.stage in asleep }.sumOf { it.endTime.toEpochMilli() - it.startTime.toEpochMilli() }
                val min = ms / 60_000L
                if (min > 0) arr.put(row("sl", s, s.startTime, min))
            }
        }
        if (can(granted, BloodPressureRecord::class, false)) {
            readAll(client, BloodPressureRecord::class, range, emptySet()).filter(::other).take(MAX_IN).forEach {
                val o = row("bp", it, it.time, Math.round(it.systolic.inMillimetersOfMercury), Math.round(it.diastolic.inMillimetersOfMercury))
                o.put("a", when (it.measurementLocation) {
                    BloodPressureRecord.MEASUREMENT_LOCATION_LEFT_UPPER_ARM, BloodPressureRecord.MEASUREMENT_LOCATION_LEFT_WRIST -> 1
                    BloodPressureRecord.MEASUREMENT_LOCATION_RIGHT_UPPER_ARM, BloodPressureRecord.MEASUREMENT_LOCATION_RIGHT_WRIST -> 2
                    else -> 0
                })
                o.put("p", when (it.bodyPosition) {
                    BloodPressureRecord.BODY_POSITION_SITTING_DOWN -> 1
                    BloodPressureRecord.BODY_POSITION_STANDING_UP -> 2
                    BloodPressureRecord.BODY_POSITION_LYING_DOWN, BloodPressureRecord.BODY_POSITION_RECLINING -> 3
                    else -> 0
                })
                arr.put(o)
            }
        }
        if (can(granted, BloodGlucoseRecord::class, false)) {
            readAll(client, BloodGlucoseRecord::class, range, emptySet()).filter(::other).take(MAX_IN).forEach {
                val o = row("gl", it, it.time, Math.round(it.level.inMilligramsPerDeciliter * 10.0))
                o.put("c", when (it.relationToMeal) {
                    BloodGlucoseRecord.RELATION_TO_MEAL_FASTING -> 1
                    BloodGlucoseRecord.RELATION_TO_MEAL_BEFORE_MEAL -> 2
                    BloodGlucoseRecord.RELATION_TO_MEAL_AFTER_MEAL -> 3
                    else -> 0
                })
                arr.put(o)
            }
        }
        if (can(granted, OxygenSaturationRecord::class, false)) {
            readAll(client, OxygenSaturationRecord::class, range, emptySet()).filter(::other).take(MAX_IN).forEach {
                arr.put(row("o2", it, it.time, Math.round(it.percentage.value)))
            }
        }
        return arr
    }

    /** Own records in the window that orOS no longer has: deleted. */
    private suspend fun <T : Record> prune(
        client: HealthConnectClient, type: KClass<T>, range: TimeRangeFilter, me: String,
        prefix: String, keep: Set<String>, sent: JSONObject,
    ): Int {
        val gone = ArrayList<String>()
        for (r in readAll(client, type, range, setOf(DataOrigin(me)))) {
            val cid = r.metadata.clientRecordId ?: continue
            if (cid.startsWith(prefix) && cid !in keep) gone += cid
        }
        for (chunk in gone.chunked(500)) client.deleteRecords(type, emptyList(), chunk)
        gone.forEach { sent.remove(it) }
        return gone.size
    }

    private suspend fun <T : Record> readAll(
        client: HealthConnectClient, type: KClass<T>, range: TimeRangeFilter, origins: Set<DataOrigin>,
    ): List<T> {
        val out = ArrayList<T>()
        var token: String? = null
        do {
            val res = client.readRecords(
                ReadRecordsRequest(
                    recordType = type, timeRangeFilter = range, dataOriginFilter = origins,
                    pageSize = 1000, pageToken = token,
                )
            )
            out += res.records
            token = res.pageToken
        } while (token != null && out.size < 20000)
        return out
    }

    private fun kind(t: Int): String = when (t) {
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING, ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "running"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "walking"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING, ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "cycling"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL, ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "swimming"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "hiking"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING, ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "strength"
        else -> "other"
    }
}
