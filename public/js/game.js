// ======================================================
// GAME.JS
// Trivia Live
// ======================================================

const socket = io();

// ======================================================
// ELEMENTOS
// ======================================================

const gameDiv =
    document.getElementById('game');

const timerDiv =
    document.getElementById('timer');

const rankingDiv =
    document.getElementById('ranking');

// ======================================================
// ESTADO
// ======================================================

let locked = false;

// ======================================================
// OBTENER JUGADOR
// ======================================================

const stored =
    localStorage.getItem(
        'trivia_player'
    );

if (!stored) {

    window.location.href =
        '/views/login.html';
}

const player =
    JSON.parse(stored);

// ======================================================
// JOIN
// ======================================================

socket.on('connect', () => {

    socket.emit(
        'join_lobby',
        player.nombre
    );

    console.log(
        '🟢 Socket conectado'
    );
});

// ======================================================
// PREGUNTA
// ======================================================

socket.on(
    'enviar_pregunta',

    (q) => {

        locked = false;

        gameDiv.innerHTML = `
            <h2 class="mb-4">
                ${q.pregunta}
            </h2>
        `;

        // ==============================================
        // OPCIONES
        // ==============================================

        q.opciones.forEach(op => {

            const btn =
                document.createElement(
                    'button'
                );

            btn.className =
                'btn btn-primary d-block mb-3 w-100';

            btn.innerText = op;

            btn.onclick = () => {

                if (locked) return;

                locked = true;

                socket.emit(
                    'respuesta_usuario',
                    {
                        respuesta: op
                    }
                );

                // COLOR
                if (
                    op === q.correcta
                ) {

                    btn.classList.remove(
                        'btn-primary'
                    );

                    btn.classList.add(
                        'btn-success'
                    );

                } else {

                    btn.classList.remove(
                        'btn-primary'
                    );

                    btn.classList.add(
                        'btn-danger'
                    );
                }
            };

            gameDiv.appendChild(btn);
        });
    }
);

// ======================================================
// TIMER
// ======================================================

socket.on('timer', (t) => {

    timerDiv.innerText =
        `Tiempo: ${t}`;
});

// ======================================================
// RANKING
// ======================================================

socket.on(
    'ranking',

    (players) => {

        rankingDiv.innerHTML = '';

        // ==============================================
        // ORDENAR
        // ==============================================

        const ordered =
            [...players].sort(

                (a, b) =>
                    b.puntos - a.puntos
            );

        // ==============================================
        // RENDER
        // ==============================================

        ordered.forEach(

            (player, index) => {

                const item =
                    document.createElement(
                        'div'
                    );

                item.className =
                    'ranking-item mb-3';

                item.innerHTML = `

                    <div class="panel">

                        <h3>
                            #${index + 1}
                            - ${player.nombre}
                        </h3>

                        <h1>
                            ${player.puntos}
                        </h1>

                    </div>

                `;

                rankingDiv.appendChild(
                    item
                );
            }
        );
    }
);

// ======================================================
// GAME OVER
// ======================================================

socket.on(
    'game_over',

    (players) => {

        const ordered =
            [...players].sort(

                (a, b) =>
                    b.puntos - a.puntos
            );

        const winner =
            ordered[0];

        gameDiv.innerHTML = `

            <div class="panel text-center">

                <h1>
                    🏆 GANADOR
                </h1>

                <h2 class="mt-4">

                    ${winner?.nombre || 'Nadie'}

                </h2>

                <h1 class="mt-3">

                    ${winner?.puntos || 0}
                    pts

                </h1>

            </div>

        `;
    }
);