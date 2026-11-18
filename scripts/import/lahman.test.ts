import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadLahmanSeasons } from './lahman'

test('Lahman uses actual exact position appearances, full workloads, known age and hands', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lahman-comp-'))
  const csv = (name: string, rows: string[]) => writeFileSync(join(dir, name), rows.join('\n') + '\n')
  try {
    csv('People.csv', ['playerID,birthYear,birthMonth,birthDay,nameFirst,nameLast,bats,throws',
      'ss,1976,7,1,Good,Shortstop,B,R', 'low,1976,6,30,Low,Playingtime,R,R', 'util,1976,6,30,Utility,Player,R,R',
      'generic,1976,6,30,Generic,Outfield,R,R', 'twob,1976,6,30,Good,Second,L,R', 'pitcher,1976,6,30,Good,Starter,R,L',
      'relief,1976,6,30,Good,Reliever,R,R', 'swing,1976,6,30,Mixed,Pitcher,R,R', 'bad,1976,6,30,Missing,Counts,R,R',
      'walk,1976,6,30,High,Walk,R,R'])
    const batHeader = 'playerID,yearID,AB,H,2B,3B,HR,BB,SO,HBP,SF,SH,SB,G'
    csv('Batting.csv', [batHeader,
      'ss,2000,500,140,30,5,20,60,100,5,5,0,10,140',
      'low,2000,270,70,10,2,4,32,70,5,5,0,1,90',
      'util,2000,500,140,30,5,20,60,100,5,5,0,10,140',
      'generic,2000,500,140,30,5,20,60,100,5,5,0,10,140',
      'twob,2000,500,140,30,5,20,60,100,5,5,0,10,140',
      'walk,2000,350,100,20,2,20,120,100,5,5,0,10,140',
      'bad,2000,500,140,30,5,20,60,,5,5,0,10,140'])
    const appHeader = 'playerID,yearID,G_c,G_1b,G_2b,G_3b,G_ss,G_lf,G_cf,G_rf,G_dh,G_of'
    csv('Appearances.csv', [appHeader,
      'ss,2000,0,0,0,0,125,0,0,0,0,0', 'low,2000,0,0,0,0,90,0,0,0,0,0',
      'util,2000,0,40,45,0,55,0,0,0,0,0', 'generic,2000,0,0,0,0,0,0,0,0,0,140',
      'twob,2000,0,0,130,0,0,0,0,0,0,0', 'bad,2000,0,0,0,0,130,0,0,0,0,0',
      'walk,2000,0,0,0,0,130,0,0,0,0,0'])
    csv('Pitching.csv', ['playerID,yearID,IPouts,BFP,BB,SO,HR,GS,G',
      'pitcher,2000,540,700,50,150,15,30,30', 'relief,2000,180,240,20,60,5,0,60',
      'swing,2000,360,500,50,100,15,15,40', 'bad,2000,540,,50,150,15,30,30'])
    const result = await loadLahmanSeasons(dir)
    assert.deepEqual(result.seasons.map((s) => s.name).sort(), ['Good Reliever', 'Good Second', 'Good Shortstop', 'Good Starter', 'High Walk'])
    const ss = result.seasons.find((s) => s.name === 'Good Shortstop')!
    assert.equal(ss.positionCode, 6)
    assert.equal(ss.bat?.positionGames, 125)
    assert.equal(ss.age, 23)
    assert.equal(ss.bats, 'S')
    assert.equal(result.seasons.find((s) => s.name === 'Good Second')?.positionCode, 4)
    const pitcher = result.seasons.find((s) => s.name === 'Good Starter')!
    assert.equal(pitcher.throws, 'L')
    assert.equal(pitcher.pit?.ip, 180)
    assert.equal(pitcher.pit?.bf, 700)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
