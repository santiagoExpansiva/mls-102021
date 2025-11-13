/// <mls shortName="routes" project="102021" enhancement="_blank" folder="layer_2_controllers" />

export const routesDefinition = [
    {
        "endpoint": "addUser",
        "description": "Adiciona um novo usuário ao sistema",
        "entity": "User",
        "file": "layer_2_controllers/addUser"
    },
    {
        "endpoint": "uppUser",
        "description": "Atualiza os dados de um usuário existente",
        "entity": "User",
        "file": "layer_2_controllers/uppUser"
    },
    {
        "endpoint": "delUser",
        "description": "Remove um usuário do sistema",
        "entity": "User",
        "file": "layer_2_controllers/delUser"
    },
    {
        "endpoint": "listUser",
        "description": "Lista todos os usuários cadastrados",
        "entity": "User",
        "file": "layer_2_controllers/listUser"
    }
]