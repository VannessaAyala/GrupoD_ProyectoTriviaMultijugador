// ======================================================
// AUTH.JS
// Sistema de autenticación - Trivia Live
// ======================================================

// ======================================================
// ELEMENTOS
// ======================================================

const inputNombre = document.getElementById('nombre');
const btnJoin = document.getElementById('btnJoin');
const joinBox = document.querySelector('.join-box');

// ======================================================
// VALIDAR NOMBRE
// ======================================================

function validarNombre(nombre) {

    nombre = String(nombre || '').trim();

    if (nombre.length === 0) {

        mostrarError('Ingresa un nombre');

        return false;
    }

    if (nombre.length < 3) {

        mostrarError('Mínimo 3 caracteres');

        return false;
    }

    if (nombre.length > 15) {

        mostrarError('Máximo 15 caracteres');

        return false;
    }

    const regex = /^[a-zA-Z0-9_ ]+$/;

    if (!regex.test(nombre)) {

        mostrarError('Caracteres inválidos');

        return false;
    }

    return true;
}

// ======================================================
// GUARDAR JUGADOR
// ======================================================

function guardarJugador(nombre, sala = '1234') {

    const jugador = {

        nombre: nombre.trim(),

        sala: sala,

        fechaIngreso: new Date().toISOString()
    };

    localStorage.setItem(
        'trivia_player',
        JSON.stringify(jugador)
    );
}

// ======================================================
// OBTENER JUGADOR
// ======================================================

function obtenerJugador() {

    try {

        const data = localStorage.getItem('trivia_player');

        if (!data) return null;

        return JSON.parse(data);

    } catch (error) {

        console.log(error);

        return null;
    }
}

// ======================================================
// CERRAR SESIÓN
// ======================================================

function cerrarSesion() {

    localStorage.removeItem('trivia_player');

    window.location.href = '/views/login.html';
}

// ======================================================
// MOSTRAR ERROR
// ======================================================

function mostrarError(mensaje) {

    if (!joinBox) return;

    eliminarMensajes();

    const errorDiv = document.createElement('div');

    errorDiv.id = 'auth-error';

    errorDiv.style.background = '#ef4444';
    errorDiv.style.color = 'white';
    errorDiv.style.padding = '15px';
    errorDiv.style.marginTop = '15px';
    errorDiv.style.borderRadius = '12px';
    errorDiv.style.fontWeight = '600';
    errorDiv.style.textAlign = 'center';

    errorDiv.innerText = mensaje;

    joinBox.appendChild(errorDiv);

    setTimeout(() => {

        errorDiv.remove();

    }, 3000);
}

// ======================================================
// MOSTRAR INFO
// ======================================================

function mostrarInfo(mensaje) {

    if (!joinBox) return;

    eliminarMensajes();

    const infoDiv = document.createElement('div');

    infoDiv.id = 'auth-info';

    infoDiv.style.background = '#22c55e';
    infoDiv.style.color = 'white';
    infoDiv.style.padding = '15px';
    infoDiv.style.marginTop = '15px';
    infoDiv.style.borderRadius = '12px';
    infoDiv.style.fontWeight = '600';
    infoDiv.style.textAlign = 'center';

    infoDiv.innerText = mensaje;

    joinBox.appendChild(infoDiv);

    setTimeout(() => {

        infoDiv.remove();

    }, 2500);
}

// ======================================================
// ELIMINAR MENSAJES
// ======================================================

function eliminarMensajes() {

    const error = document.getElementById('auth-error');
    const info = document.getElementById('auth-info');

    if (error) error.remove();
    if (info) info.remove();
}

// ======================================================
// AUTO LOGIN
// ======================================================

window.addEventListener('DOMContentLoaded', () => {

    const jugador = obtenerJugador();

    if (jugador && inputNombre) {

        inputNombre.value = jugador.nombre;

        mostrarInfo(`Bienvenido nuevamente ${jugador.nombre}`);
    }
});

// ======================================================
// BOTÓN UNIRSE
// ======================================================

if (btnJoin && inputNombre) {

    btnJoin.addEventListener('click', () => {

        const nombre = inputNombre.value.trim();

        if (!validarNombre(nombre)) return;

        guardarJugador(nombre);

        mostrarInfo('Jugador registrado correctamente');

        setTimeout(() => {

            window.location.href = '/views/lobby.html';

        }, 1000);
    });
}

// ======================================================
// ENTER
// ======================================================

if (inputNombre) {

    inputNombre.addEventListener('keypress', (e) => {

        if (e.key === 'Enter') {

            e.preventDefault();

            btnJoin?.click();
        }
    });
}

// ======================================================
// EXPORTAR
// ======================================================

window.Auth = {

    validarNombre,

    guardarJugador,

    obtenerJugador,

    cerrarSesion
};