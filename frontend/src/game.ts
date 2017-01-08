import { Commands, Command } from './commands';
import { Lander, tick } from './lander';
import * as seedrandom from 'seedrandom';
import { terrain, flag } from './terrain';
import { Vector, Geometry } from './geometry';
import { sky, render } from './render';
import { uniqueColor } from './color';
import UI from './ui';


export class GameState {
    public players: PlayerMsg[] = []
    public landers: Lander[] = []
    public commands: Commands = []
    public phase: GamePhase = GamePhase.INITIALIZING
    constructor(public readonly ctx: CanvasRenderingContext2D,
        public readonly rng: seedrandom.prng,
        public readonly fgTerrain: Geometry,
        public readonly bgTerrain: Geometry,
        public readonly flagPosition: Vector,
        public readonly skybox: ImageData,
        public readonly ws?: WebSocket) { }
}

export function setup(ctx: CanvasRenderingContext2D, seed: string) {
    let rng = seedrandom(seed);
    let ws = new WebSocket("ws://localhost:4711");
    ws.onmessage = function (this: WebSocket, msg: MessageEvent) {
        handleMessage(this, msg, state);
    };
    ws.onclose = function (this: WebSocket, ev: CloseEvent) {
        console.log('WebSocket connection closed: ' + ev.reason);
    };
    ws.onerror = console.error;
    let fgTerrain = terrain(10000, 350, rng, 9, 4);
    let bgTerrain = terrain(2500, 350, rng, 8, 3).map((p) => new Vector(p.x * 2, p.y + 50));
    let skybox = sky(3500, 800);
    let flagPosition = flag(fgTerrain, rng);
    let state = new GameState(ctx, rng, fgTerrain, bgTerrain, flagPosition, skybox, ws);
    return state;
}

export function start(state: GameState, ctx: CanvasRenderingContext2D) {
    state.phase = GamePhase.STARTED;
    send(state.ws, 'broadcast', '', { game: 'start' });
    let tickNo = 0;
    setInterval(() => {
        state.landers = state.landers.map((lander) => {
            let cmds = state.commands.filter(
                (c) => (!c.tick || c.tick <= tickNo) && c.token === lander.token);
            return tick(tickNo, cmds, lander, state.fgTerrain)
        });
        if (tickNo % 5 === 0) UI.update(state.landers, state.flagPosition);
        state.commands = state.commands.filter((c) => c.tick > tickNo);
        requestAnimationFrame((t) => {
            let focus = new Vector(
                state.landers.reduce((p, c) => {
                    if (Math.abs(state.flagPosition.x - c.position.x) < Math.abs(state.flagPosition.x - p.position.x)) {
                        return c;
                    } else {
                        return p;
                    }
                }).position.x
                , 0);
            render(ctx, focus, state.landers, state.fgTerrain, state.bgTerrain, state.skybox, state.flagPosition);
        });
        tickNo++;
    }, 25);
}

function handleMessage(ws: WebSocket, msg: MessageEvent, state: GameState) {
    let data = JSON.parse(msg.data);
    if (state.phase === GamePhase.INITIALIZING && data.host === true) {
        state.phase = GamePhase.HOST_CONFIRMED;
    } else if (state.phase === GamePhase.HOST_CONFIRMED && isPlayerMsg(data)) {
        data.color = uniqueColor(data.name);
        state.players = state.players.concat(data);
        state.landers = state.landers.concat(new Lander(
            data.token,
            data.color,
            new Vector(1000, 300),
            new Vector(0, 0),
            0,
            "off",
            0,
            "off",
            1000));
        UI.addPlayer(data.token, data.name, data.color);
        send(state.ws, 'broadcast', '', {
            terrain: state.fgTerrain,
            flag: state.flagPosition
        });
    } else if (state.phase === GamePhase.STARTED && isCommandsMsg(data)) {
        state.commands = state.commands.concat(
            data.commands.map(
                cmd => new Command(data.token, cmd.engine, cmd.rotation, cmd.tick))
        );
    } else {
        console.error(`Dropped message in ${GamePhase[state.phase]}`, data);
    }
}

function send(ws: WebSocket, cmd: 'broadcast' | 'to' | 'disconnect', cval: string, data: any) {
    ws.send(`${cmd}:${cval}
${JSON.stringify(data)}`);
}

/// --- typeguards & interfaces ---
enum GamePhase {
    INITIALIZING,
    HOST_CONFIRMED,
    STARTED
}

interface PlayerMsg {
    token: string
    name: string
    color?: string
}

function isPlayerMsg(data: any): data is PlayerMsg {
    return (<PlayerMsg>data).token !== undefined &&
        (<PlayerMsg>data).name !== undefined;
}

interface CommandsMsg {
    token: string
    commands: Commands
}

function isCommandsMsg(data: any): data is CommandsMsg {
    return (<CommandsMsg>data).token !== undefined &&
        (<CommandsMsg>data).commands !== undefined;
}

interface HostConfirmMsg {
    host: boolean
}
