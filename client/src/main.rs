use std::io::{self, Write};

use azalea::{
    BlockPos, Client, Event, SprintDirection, WalkDirection,
    core::{direction::Direction, game_type::GameMode, position::Vec3},
    entity::inventory::Inventory,
    interact::BlockStatePredictionHandler,
    inventory::ItemStack,
    prelude::Account,
    protocol::packets::{
        PROTOCOL_VERSION,
        game::s_client_command::{Action as ClientCommandAction, ServerboundClientCommand},
        game::s_interact::InteractionHand,
        game::s_use_item_on::{BlockHit, ServerboundUseItemOn},
    },
};
use eyre::{Result, WrapErr, bail, eyre};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, BufReader};

const MINECRAFT_VERSION: &str = "26.2";
const AZALEA_REVISION: &str = "c35b57ebf82fa8b26ada77ab9eb795e3827d6c16";

#[derive(Debug, Deserialize)]
struct Request {
    id: u64,
    command: String,
    #[serde(default)]
    data: Value,
}

// Azalea schedules ECS ticks with `spawn_local`; a current-thread runtime is
// the supported deterministic mode for a standalone client process.
#[tokio::main(flavor = "current_thread")]
async fn main() {
    let local = tokio::task::LocalSet::new();
    if let Err(error) = local.run_until(run()).await {
        emit(&json!({
            "kind": "fatal",
            "error": format!("{error:#}"),
        }));
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if arguments.iter().any(|argument| argument == "--version") {
        emit(&json!({
            "kind": "version",
            "minecraft": MINECRAFT_VERSION,
            "protocol": PROTOCOL_VERSION,
            "engine": "azalea",
            "engineRevision": AZALEA_REVISION,
        }));
        return Ok(());
    }

    let host = argument(&arguments, "--host").unwrap_or_else(|| "127.0.0.1".to_owned());
    let port = argument(&arguments, "--port").unwrap_or_else(|| "25565".to_owned());
    let username =
        argument(&arguments, "--username").ok_or_else(|| eyre!("--username is required"))?;
    let address = format!("{host}:{port}");
    let (client, mut events) = Client::join(Account::offline(&username), address.clone())
        .await
        .wrap_err_with(|| format!("resolving Minecraft server {address}"))?;

    emit(&json!({
        "kind": "started",
        "minecraft": MINECRAFT_VERSION,
        "protocol": PROTOCOL_VERSION,
        "username": username,
    }));

    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut has_spawned = false;
    let mut awaiting_respawn = false;
    let mut last_window = 0;
    let mut last_health: Option<f32> = None;

    loop {
        tokio::select! {
            request_line = lines.next_line() => {
                let Some(request_line) = request_line.wrap_err("reading harness client request")? else {
                    client.disconnect();
                    break;
                };
                let request: Request = match serde_json::from_str(&request_line) {
                    Ok(request) => request,
                    Err(error) => {
                        emit(&json!({ "kind": "protocol_error", "error": error.to_string() }));
                        continue;
                    }
                };
                let request_id = request.id;
                match execute(&client, request) {
                    Ok((data, should_exit)) => {
                        emit(&json!({ "kind": "response", "id": request_id, "ok": true, "data": data }));
                        if should_exit {
                            client.disconnect();
                            break;
                        }
                    }
                    Err(error) => emit(&json!({
                        "kind": "response",
                        "id": request_id,
                        "ok": false,
                        "error": format!("{error:#}"),
                    })),
                }
            }
            event = events.recv() => {
                let Some(event) = event else { break };
                match event {
                    Event::Spawn => {
                        let event_type = if has_spawned { "dimension_change" } else { "spawn" };
                        has_spawned = true;
                        awaiting_respawn = false;
                        emit_event(event_type, snapshot(&client));
                    }
                    Event::Chat(message) => emit_event("message", json!({ "message": message.content() })),
                    Event::Death(reason) => {
                        if !awaiting_respawn {
                            awaiting_respawn = true;
                            emit_event("death", json!({
                                "reason": reason.map(|packet| packet.message.to_string()),
                                "state": snapshot(&client),
                            }));
                        }
                    }
                    Event::AddPlayer(player) => emit_event("player_joined", json!({
                        "username": player.profile.name,
                        "uuid": player.uuid.to_string(),
                    })),
                    Event::RemovePlayer(player) => emit_event("player_left", json!({
                        "username": player.profile.name,
                        "uuid": player.uuid.to_string(),
                    })),
                    Event::Disconnect(reason) => {
                        emit_event("end", json!({ "reason": reason.map(|value| value.to_string()) }));
                        break;
                    }
                    Event::ConnectionFailed(error) => {
                        emit_event("error", json!({ "message": error.to_string() }));
                        break;
                    }
                    Event::Tick => {
                        let window = current_window(&client);
                        let current_id = window.as_ref()
                            .and_then(|value| value.get("id"))
                            .and_then(Value::as_i64)
                            .unwrap_or(0) as i32;
                        if current_id != last_window {
                            if current_id == 0 {
                                emit_event("window_close", json!({ "id": last_window }));
                            } else {
                                emit_event("window_open", window.unwrap_or(Value::Null));
                            }
                            last_window = current_id;
                        }
                        let health = client.health().ok();
                        if health != last_health {
                            if last_health.is_some() {
                                let hunger = client.hunger().ok();
                                emit_event("health", json!({
                                    "health": health,
                                    "food": hunger.map(|value| value.food),
                                }));
                            }
                            last_health = health;
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    Ok(())
}

fn execute(client: &Client, request: Request) -> Result<(Value, bool)> {
    let data = request.data;
    let result = match request.command.as_str() {
        "chat" => {
            client.chat(required_string(&data, "message")?);
            Value::Null
        }
        "look" => {
            client.set_direction(
                required_f64(&data, "yaw")? as f32,
                required_f64(&data, "pitch")? as f32,
            )?;
            Value::Null
        }
        "select_hotbar" => {
            let slot = required_u64(&data, "slot")?;
            if slot > 8 {
                bail!("hotbar slot must be in the range 0..=8");
            }
            client.set_selected_hotbar_slot(slot as u8);
            Value::Null
        }
        "move" => {
            set_control(
                client,
                required_string(&data, "control")?,
                data.get("enabled").and_then(Value::as_bool).unwrap_or(true),
            )?;
            Value::Null
        }
        "use_block" => {
            client.block_interact(block_position(&data)?);
            Value::Null
        }
        "place_block" => {
            place_block(client, &data)?;
            Value::Null
        }
        "break_block" => {
            client.start_mining(block_position(&data)?);
            Value::Null
        }
        "attack" => {
            let target = required_string(&data, "target")?;
            let uuid = client
                .player_uuid_by_username(target)?
                .ok_or_else(|| eyre!("player {target} is not in the tab list"))?;
            let entity = client
                .entity_id_by_uuid(uuid)
                .ok_or_else(|| eyre!("player {target} is outside render distance"))?;
            client.attack(entity);
            Value::Null
        }
        "respawn" => {
            client.write_packet(ServerboundClientCommand {
                action: ClientCommandAction::PerformRespawn,
            });
            Value::Null
        }
        "click_window" => {
            let slot = required_u64(&data, "slot")? as usize;
            let button = data.get("button").and_then(Value::as_u64).unwrap_or(0);
            let mode = data.get("mode").and_then(Value::as_u64).unwrap_or(0);
            let inventory = client.get_inventory()?;
            match (mode, button) {
                (0, 0) => inventory.left_click(slot),
                (0, 1) => inventory.right_click(slot),
                (1, _) => inventory.shift_click(slot),
                _ => bail!("unsupported window click mode={mode}, button={button}"),
            }
            Value::Null
        }
        "state" => snapshot(client),
        "disconnect" => return Ok((Value::Null, true)),
        command => bail!("unsupported command {command}"),
    };
    Ok((result, false))
}

fn set_control(client: &Client, control: &str, enabled: bool) -> Result<()> {
    match control {
        "forward" => client.walk(if enabled {
            WalkDirection::Forward
        } else {
            WalkDirection::None
        }),
        "back" => client.walk(if enabled {
            WalkDirection::Backward
        } else {
            WalkDirection::None
        }),
        "left" => client.walk(if enabled {
            WalkDirection::Left
        } else {
            WalkDirection::None
        }),
        "right" => client.walk(if enabled {
            WalkDirection::Right
        } else {
            WalkDirection::None
        }),
        "sprint" => {
            if enabled {
                client.sprint(SprintDirection::Forward)
            } else {
                client.walk(WalkDirection::None)
            }
        }
        "jump" => client.set_jumping(enabled)?,
        "sneak" => client.set_crouching(enabled)?,
        other => bail!("unsupported movement control {other}"),
    }
    Ok(())
}

fn snapshot(client: &Client) -> Value {
    let hunger = client.hunger().ok();
    let experience = client.experience().ok();
    let position = client.position().ok();
    let inventory = client
        .menu()
        .ok()
        .map(|menu| {
            menu.slots().into_iter().enumerate().map(|(slot, item)| match item {
            ItemStack::Empty => Value::Null,
            ItemStack::Present(item) => json!({
                "slot": slot,
                "name": item.kind.to_str().strip_prefix("minecraft:").unwrap_or(item.kind.to_str()),
                "item": item.kind.to_string(),
                "type": item.kind as u32,
                "count": item.count,
                "components": item.component_patch,
            }),
        }).collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let game_mode = client
        .component::<GameMode>()
        .ok()
        .map(|value| value.name());
    let dimension = client.world_name().ok().map(|value| value.0.to_string());
    let mut tab_list = client
        .tab_list()
        .ok()
        .map(|players| {
            players
                .into_values()
                .map(|player| {
                    json!({
                        "username": player.profile.name,
                        "uuid": player.uuid.to_string(),
                        "displayName": player.display_name.map(|name| name.to_string()),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    tab_list.sort_by(|left, right| {
        left.get("username")
            .and_then(Value::as_str)
            .cmp(&right.get("username").and_then(Value::as_str))
    });

    json!({
        "username": client.username(),
        "uuid": client.uuid().to_string(),
        "connected": client.logged_in(),
        "health": client.health().ok(),
        "food": hunger.as_ref().map(|value| value.food),
        "saturation": hunger.as_ref().map(|value| value.saturation),
        "experience": {
            "level": experience.as_ref().map(|value| value.level),
            "progress": experience.as_ref().map(|value| value.progress),
            "points": experience.as_ref().map(|value| value.total),
        },
        "gameMode": game_mode,
        "dimension": dimension,
        "position": position.map(|value| json!({ "x": value.x, "y": value.y, "z": value.z })),
        "inventory": inventory,
        "tabList": tab_list,
        "window": current_window(client),
    })
}

fn current_window(client: &Client) -> Option<Value> {
    let inventory = client.component::<Inventory>().ok()?;
    if inventory.id == 0 {
        return None;
    }
    let menu_type = inventory.container_menu.as_ref().map(|menu| {
        format!("{menu:?}")
            .split(['(', ' '])
            .next()
            .unwrap_or("unknown")
            .to_owned()
    });
    Some(json!({
        "id": inventory.id,
        "title": inventory.container_menu_title.as_ref().map(ToString::to_string),
        "type": menu_type,
    }))
}

fn block_position(data: &Value) -> Result<BlockPos> {
    Ok(BlockPos::new(
        required_i64(data, "x")? as i32,
        required_i64(data, "y")? as i32,
        required_i64(data, "z")? as i32,
    ))
}

fn place_block(client: &Client, data: &Value) -> Result<()> {
    let block_pos = block_position(data)?;
    let direction = block_face(data)?;
    let normal = direction.normal();
    let location = Vec3 {
        x: f64::from(block_pos.x) + 0.5 + f64::from(normal.x) * 0.5,
        y: f64::from(block_pos.y) + 0.5 + f64::from(normal.y) * 0.5,
        z: f64::from(block_pos.z) + 0.5 + f64::from(normal.z) * 0.5,
    };
    let seq = {
        let mut ecs = client.ecs.write();
        ecs.get_mut::<BlockStatePredictionHandler>(client.entity)
            .ok_or_else(|| eyre!("client block prediction state is unavailable"))?
            .start_predicting()
    };
    client.write_packet(ServerboundUseItemOn {
        hand: InteractionHand::MainHand,
        block_hit: BlockHit {
            block_pos,
            direction,
            location,
            inside: false,
            world_border: false,
        },
        seq,
    });
    Ok(())
}

fn block_face(data: &Value) -> Result<Direction> {
    let face = data.get("face");
    let component = |name: &str| {
        face.and_then(|value| value.get(name))
            .and_then(Value::as_i64)
            .unwrap_or(0)
    };
    match (component("x"), component("y"), component("z")) {
        (0, -1, 0) => Ok(Direction::Down),
        (0, 1, 0) => Ok(Direction::Up),
        (0, 0, -1) => Ok(Direction::North),
        (0, 0, 1) => Ok(Direction::South),
        (-1, 0, 0) => Ok(Direction::West),
        (1, 0, 0) => Ok(Direction::East),
        other => bail!("block face must be one unit axis vector, got {other:?}"),
    }
}

fn argument(arguments: &[String], name: &str) -> Option<String> {
    arguments
        .windows(2)
        .find_map(|pair| (pair[0] == name).then(|| pair[1].clone()))
}

fn required_string<'a>(value: &'a Value, name: &str) -> Result<&'a str> {
    value
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| eyre!("{name} must be a string"))
}

fn required_f64(value: &Value, name: &str) -> Result<f64> {
    value
        .get(name)
        .and_then(Value::as_f64)
        .ok_or_else(|| eyre!("{name} must be a number"))
}

fn required_i64(value: &Value, name: &str) -> Result<i64> {
    value
        .get(name)
        .and_then(Value::as_i64)
        .ok_or_else(|| eyre!("{name} must be an integer"))
}

fn required_u64(value: &Value, name: &str) -> Result<u64> {
    value
        .get(name)
        .and_then(Value::as_u64)
        .ok_or_else(|| eyre!("{name} must be a non-negative integer"))
}

fn emit_event(event_type: &str, data: Value) {
    emit(&json!({ "kind": "event", "type": event_type, "data": data }));
}

fn emit(value: &Value) {
    let stdout = io::stdout();
    let mut lock = stdout.lock();
    serde_json::to_writer(&mut lock, value).expect("serializing JSON-lines response");
    lock.write_all(b"\n").expect("writing JSON-lines response");
    lock.flush().expect("flushing JSON-lines response");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_exact_protocol_pin() {
        assert_eq!(MINECRAFT_VERSION, "26.2");
        assert_eq!(PROTOCOL_VERSION, 776);
        assert_eq!(AZALEA_REVISION.len(), 40);
    }

    #[test]
    fn parses_block_faces_for_surface_placement() {
        assert_eq!(
            block_face(&json!({ "face": { "x": 0, "y": 1, "z": 0 } })).unwrap(),
            Direction::Up
        );
        assert_eq!(
            block_face(&json!({ "face": { "x": -1, "y": 0, "z": 0 } })).unwrap(),
            Direction::West
        );
        assert!(block_face(&json!({ "face": { "x": 1, "y": 1, "z": 0 } })).is_err());
    }
}
